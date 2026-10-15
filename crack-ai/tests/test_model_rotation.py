"""
Unit tests for crack-ai/model_rotation.py

Covers:
- Round-robin rotation across available models
- Cooldown on rate limit (429) and on generic errors
- Strike system (extended cooldown after repeated failures)
- Fallback when every model is cooling down
- Status reporting
- Model list parsing from settings
"""
import time

import pytest

from model_rotation import (
    COOLDOWN_ERROR,
    COOLDOWN_RATE_LIMIT,
    COOLDOWN_STRIKE,
    FAILURE_STRIKE_LIMIT,
    ModelEntry,
    ModelRotation,
    parse_model_list,
)

MODEL_A = "provider/model-a:free"
MODEL_B = "provider/model-b:free"
MODEL_C = "provider/model-c:free"


@pytest.fixture
def rotation() -> ModelRotation:
    return ModelRotation([MODEL_A, MODEL_B, MODEL_C])


class TestRoundRobin:
    @pytest.mark.asyncio
    async def test_acquire_cycles_through_all_models(self, rotation: ModelRotation):
        picks = [await rotation.acquire() for _ in range(6)]
        assert picks == [MODEL_A, MODEL_B, MODEL_C, MODEL_A, MODEL_B, MODEL_C]

    @pytest.mark.asyncio
    async def test_acquire_skips_cooled_down_models(self, rotation: ModelRotation):
        await rotation.report_rate_limit(MODEL_A)

        picks = [await rotation.acquire() for _ in range(4)]
        assert MODEL_A not in picks
        assert set(picks) == {MODEL_B, MODEL_C}

    @pytest.mark.asyncio
    async def test_constructor_rejects_empty_pool(self):
        with pytest.raises(ValueError, match="at least one model"):
            ModelRotation([])


class TestCooldown:
    @pytest.mark.asyncio
    async def test_rate_limit_sets_short_cooldown(self, rotation: ModelRotation):
        await rotation.report_rate_limit(MODEL_A)

        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        assert not entry.is_available(time.monotonic())
        assert entry.consecutive_failures == 1

    @pytest.mark.asyncio
    async def test_generic_error_sets_cooldown(self, rotation: ModelRotation):
        await rotation.report_error(MODEL_A, RuntimeError("boom"))

        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        remaining = entry.cooldown_until - time.monotonic()
        assert remaining > 0
        assert remaining <= COOLDOWN_ERROR

    @pytest.mark.asyncio
    async def test_success_resets_failure_counter(self, rotation: ModelRotation):
        await rotation.report_error(MODEL_A)
        await rotation.report_error(MODEL_A)
        await rotation.report_success(MODEL_A)

        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        assert entry.consecutive_failures == 0

    @pytest.mark.asyncio
    async def test_cooldown_expires_and_model_rejoins_pool(self, rotation: ModelRotation):
        await rotation.report_rate_limit(MODEL_A)
        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        # Force the cooldown to expire instantly (don't sleep in tests)
        entry.cooldown_until = time.monotonic() - 1

        picks = [await rotation.acquire() for _ in range(3)]
        assert MODEL_A in picks


class TestStrikeSystem:
    @pytest.mark.asyncio
    async def test_repeated_failures_extend_cooldown(self, rotation: ModelRotation):
        for _ in range(FAILURE_STRIKE_LIMIT - 1):
            await rotation.report_rate_limit(MODEL_A)
        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        short_cooldown_remaining = entry.cooldown_until - time.monotonic()
        assert short_cooldown_remaining <= COOLDOWN_RATE_LIMIT

        # One more failure hits the strike limit → extended cooldown
        await rotation.report_rate_limit(MODEL_A)
        long_cooldown_remaining = entry.cooldown_until - time.monotonic()
        assert long_cooldown_remaining > COOLDOWN_RATE_LIMIT
        assert long_cooldown_remaining <= COOLDOWN_STRIKE

    @pytest.mark.asyncio
    async def test_success_then_failure_starts_short_again(self, rotation: ModelRotation):
        await rotation.report_error(MODEL_A)
        await rotation.report_error(MODEL_A)
        await rotation.report_success(MODEL_A)
        await rotation.report_error(MODEL_A)

        entry = next(e for e in rotation._entries if e.model_id == MODEL_A)
        assert entry.consecutive_failures == 1


class TestAllCoolingDown:
    @pytest.mark.asyncio
    async def test_forces_earliest_cooldown_model(self, rotation: ModelRotation):
        await rotation.report_rate_limit(MODEL_A)  # 60s
        await rotation.report_error(MODEL_B)       # 30s (shorter)
        await rotation.report_error(MODEL_C)       # 30s

        pick = await rotation.acquire()
        # B and C share the shorter cooldown; either is acceptable, but it must
        # NOT be A (longest cooldown) unless it's the only option.
        assert pick in (MODEL_B, MODEL_C)


class TestStatus:
    @pytest.mark.asyncio
    async def test_status_reports_availability_and_failures(self, rotation: ModelRotation):
        await rotation.report_rate_limit(MODEL_A)

        status = {s["model"]: s for s in rotation.status()}

        assert status[MODEL_A]["available"] is False
        assert status[MODEL_A]["consecutive_failures"] == 1
        assert status[MODEL_A]["cooldown_remaining"] > 0
        assert status[MODEL_B]["available"] is True
        assert status[MODEL_C]["available"] is True
        assert len(status) == 3

    @pytest.mark.asyncio
    async def test_status_is_a_snapshot_list(self, rotation: ModelRotation):
        status = rotation.status()
        assert isinstance(status, list)
        assert set(status[0].keys()) == {
            "model",
            "available",
            "cooldown_remaining",
            "consecutive_failures",
        }


class TestParseModelList:
    def test_parses_comma_separated_string(self):
        assert parse_model_list("a/one:free, b/two:free") == ["a/one:free", "b/two:free"]

    def test_empty_string_falls_back_to_default_pool(self):
        defaults = parse_model_list("")
        assert len(defaults) >= 10
        assert all(m.endswith(":free") for m in defaults)

    def test_whitespace_only_falls_back_to_default_pool(self):
        assert parse_model_list("   ") == parse_model_list("")

    def test_strips_blank_entries(self):
        assert parse_model_list("a/one:free,,  ,b/two:free") == ["a/one:free", "b/two:free"]


class TestModelEntry:
    def test_is_available_before_cooldown(self):
        entry = ModelEntry(model_id=MODEL_A)
        assert entry.is_available(time.monotonic())

    def test_is_unavailable_during_cooldown(self):
        entry = ModelEntry(model_id=MODEL_A, cooldown_until=time.monotonic() + 100)
        assert not entry.is_available(time.monotonic())
