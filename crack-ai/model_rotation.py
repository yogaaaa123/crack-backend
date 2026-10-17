"""
CrackPOS AI — OpenRouter Free Model Rotation

OpenRouter free tier (:free) has a strict per-model rate limit (~20 req/min/model).
Instead of relying on one model, we rotate across all free models and temporarily
cool down a model when it hits a rate limit or errors, so requests keep flowing.

STRATEGY:
- Round-robin rotation across available (not cooling-down) models
- On 429 (rate limit): model goes on cooldown (longer)
- On other errors: model goes on cooldown (shorter), failures counted
- On success: model failure counter resets
- If ALL models are cooling down: pick the one with the earliest cooldown
  (better to try than to fail immediately)
"""
import asyncio
import time
from dataclasses import dataclass, field

from config import settings
from logging_config import get_logger

logger = get_logger(__name__)

# Cooldown durations (seconds)
COOLDOWN_RATE_LIMIT = 60.0
COOLDOWN_ERROR = 30.0
# After this many consecutive errors, cooldown is extended
FAILURE_STRIKE_LIMIT = 3
COOLDOWN_STRIKE = 300.0


@dataclass
class ModelEntry:
    """State of one model in the rotation pool."""
    model_id: str
    consecutive_failures: int = 0
    cooldown_until: float = field(default=0.0)

    def is_available(self, now: float) -> bool:
        return now >= self.cooldown_until


class ModelRotation:
    """Thread/async-safe round-robin rotation over a pool of models."""

    def __init__(self, model_ids: list[str]):
        if not model_ids:
            raise ValueError("ModelRotation requires at least one model ID")
        self._entries = [ModelEntry(model_id=mid) for mid in model_ids]
        self._lock = asyncio.Lock()
        self._cursor = 0

    async def acquire(self) -> str:
        """Pick the next available model (round-robin). Resets to pool start on use."""
        async with self._lock:
            now = time.monotonic()
            available = [e for e in self._entries if e.is_available(now)]

            if not available:
                # Everything is cooling down — use the one that frees up first
                entry = min(self._entries, key=lambda e: e.cooldown_until)
                logger.warning(
                    "All models cooling down, forcing earliest",
                    model=entry.model_id,
                )
                return entry.model_id

            entry = available[self._cursor % len(available)]
            self._cursor = (self._cursor + 1) % max(len(available), 1)
            return entry.model_id

    def _find(self, model_id: str) -> ModelEntry | None:
        for entry in self._entries:
            if entry.model_id == model_id:
                return entry
        return None

    async def report_success(self, model_id: str) -> None:
        entry = self._find(model_id)
        if entry:
            entry.consecutive_failures = 0

    async def report_rate_limit(self, model_id: str) -> None:
        entry = self._find(model_id)
        if entry:
            entry.consecutive_failures += 1
            cooldown = COOLDOWN_STRIKE if entry.consecutive_failures >= FAILURE_STRIKE_LIMIT else COOLDOWN_RATE_LIMIT
            entry.cooldown_until = time.monotonic() + cooldown
            logger.warning(
                "Model rate limited, cooling down",
                model=model_id,
                seconds=cooldown,
                failures=entry.consecutive_failures,
            )

    async def report_error(self, model_id: str, error: Exception | str = "") -> None:
        entry = self._find(model_id)
        if entry:
            entry.consecutive_failures += 1
            cooldown = (
                COOLDOWN_STRIKE
                if entry.consecutive_failures >= FAILURE_STRIKE_LIMIT
                else COOLDOWN_ERROR
            )
            entry.cooldown_until = time.monotonic() + cooldown
            logger.warning(
                "Model errored, cooling down",
                model=model_id,
                seconds=cooldown,
                failures=entry.consecutive_failures,
                error=str(error),
            )

    def status(self) -> list[dict]:
        """Snapshot for health/debug endpoints."""
        now = time.monotonic()
        return [
            {
                "model": e.model_id,
                "available": e.is_available(now),
                "cooldown_remaining": round(max(e.cooldown_until - now, 0.0), 1),
                "consecutive_failures": e.consecutive_failures,
            }
            for e in self._entries
        ]


def _default_free_models() -> list[str]:
    """Free tool-capable models, best-first, verified live 2026-10-16.

    Removed after probing OpenRouter (kept out to avoid burning attempts):
      - nvidia/nemotron-3-ultra-550b-a55b:free  -> request timeout
      - thinkingmachines/inkling:free           -> 403 agentic-harness-only
      - thinkingmachines/inkling-small:free     -> 403 agentic-harness-only
      - poolside/laguna-s-2.1:free              -> 429 provider error
      - poolside/laguna-xs-2.1:free             -> 429 provider error
      - google/gemma-4-31b-it:free              -> 429 provider error
      - google/gemma-4-26b-a4b-it:free          -> 429 provider error

    poolside/laguna-s-2.1:free was re-added 2026-10-17 after probing healthy
    (uptime 99.93% over 1d, tools supported). Re-probed live first.
    """
    return [
        "poolside/laguna-s-2.1:free",
        "nvidia/nemotron-3.5-lightning:free",
        "cohere/north-mini-code:free",
        "liquid/lfm-2.5-2.6b:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "dots-studio/dots-3-note-preview:free",
    ]


def parse_model_list(raw: str) -> list[str]:
    """Parse comma-separated model list from settings, dropping blanks."""
    if raw and raw.strip():
        return [m.strip() for m in raw.split(",") if m.strip()]
    return _default_free_models()


rotation = ModelRotation(parse_model_list(settings.llm_models))
