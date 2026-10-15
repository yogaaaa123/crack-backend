"""
Unit tests for crack-ai/ai_service.py — LLM call with model rotation failover.

Covers:
- Successful call on first model (no rotation side effects)
- Failover to next model on 429 rate limit
- Failover to next model on generic error
- Model marked cooled-down after failure
- RuntimeError when every attempt is exhausted
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import ai_service
from model_rotation import ModelRotation

MODEL_A = "provider/model-a:free"
MODEL_B = "provider/model-b:free"
MODEL_C = "provider/model-c:free"

MESSAGES = [{"role": "user", "content": "hello"}]


def _make_response(model: str) -> SimpleNamespace:
    """Build a minimal OpenAI-like response object."""
    message = SimpleNamespace(content=f"reply from {model}", tool_calls=None, reasoning_content=None)
    choice = SimpleNamespace(message=message, reasoning_content=None)
    return SimpleNamespace(model=model, choices=[choice])


def _make_rate_limit_error() -> Exception:
    """Build an exception shaped like openai.RateLimitError (has status_code=429)."""
    error = Exception("429 Too Many Requests")
    error.status_code = 429  # type: ignore[attr-defined]
    return error


def _make_server_error() -> Exception:
    error = Exception("500 Internal Server Error")
    error.status_code = 500  # type: ignore[attr-defined]
    return error


@pytest.fixture
def fresh_rotation() -> ModelRotation:
    """A rotation instance isolated from the module-level singleton."""
    return ModelRotation([MODEL_A, MODEL_B, MODEL_C])


@pytest.mark.asyncio
async def test_success_first_model_no_failover(fresh_rotation: ModelRotation):
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(return_value=_make_response(MODEL_A))
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        resp = await ai_service._create_completion_with_rotation(
            messages=MESSAGES, request_id="test-1"
        )

    assert resp.model == MODEL_A
    assert mock_client.chat.completions.create.await_count == 1
    # First model was asked
    assert mock_client.chat.completions.create.await_args.kwargs["model"] == MODEL_A
    # No model cooled down
    assert all(s["available"] for s in fresh_rotation.status())


@pytest.mark.asyncio
async def test_failover_on_rate_limit(fresh_rotation: ModelRotation):
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(side_effect=[_make_rate_limit_error(), _make_response(MODEL_B)])
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        resp = await ai_service._create_completion_with_rotation(
            messages=MESSAGES, request_id="test-2"
        )

    assert resp.model == MODEL_B
    assert mock_client.chat.completions.create.await_count == 2
    # The rate-limited model (first pick) must now be cooling down
    status = {s["model"]: s for s in fresh_rotation.status()}
    assert status[MODEL_A]["available"] is False
    assert status[MODEL_A]["consecutive_failures"] == 1


@pytest.mark.asyncio
async def test_failover_on_generic_error(fresh_rotation: ModelRotation):
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(side_effect=[_make_server_error(), _make_response(MODEL_C)])
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        resp = await ai_service._create_completion_with_rotation(
            messages=MESSAGES, request_id="test-3"
        )

    assert resp.model == MODEL_C
    status = {s["model"]: s for s in fresh_rotation.status()}
    assert status[MODEL_A]["available"] is False


@pytest.mark.asyncio
async def test_all_attempts_fail_raises_runtime_error(fresh_rotation: ModelRotation):
    # 3 models in pool → default max_attempts (4) will exhaust the pool
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(side_effect=_make_server_error())
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        with pytest.raises(RuntimeError, match="LLM attempts failed"):
            await ai_service._create_completion_with_rotation(
                messages=MESSAGES, request_id="test-4"
            )

    # It should have tried exactly max_attempts times (settings.llm_max_attempts)
    assert mock_client.chat.completions.create.await_count == ai_service.settings.llm_max_attempts


@pytest.mark.asyncio
async def test_success_resets_failure_counter(fresh_rotation: ModelRotation):
    # MODEL_A fails once, then succeeds on a later request
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(
                    side_effect=[
                        _make_rate_limit_error(),      # A fails
                        _make_response(MODEL_B),       # B succeeds (1st request)
                        _make_response(MODEL_C),       # C next in line (2nd request)
                    ]
                )
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        await ai_service._create_completion_with_rotation(messages=MESSAGES, request_id="test-5a")
        await ai_service._create_completion_with_rotation(messages=MESSAGES, request_id="test-5b")

    status = {s["model"]: s for s in fresh_rotation.status()}
    # A still cooling (only failed once), B & C healthy with zero failures
    assert status[MODEL_B]["consecutive_failures"] == 0
    assert status[MODEL_C]["consecutive_failures"] == 0


@pytest.mark.asyncio
async def test_deepseek_model_gets_reasoning_effort(fresh_rotation: ModelRotation):
    """DeepSeek models should receive extra_body reasoning_effort=low."""
    deepseek_model = "deepseek/deepseek-chat"
    rotation_ds = ModelRotation([deepseek_model])

    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(return_value=_make_response(deepseek_model))
            )
        )
    )

    with patch.object(ai_service, "rotation", rotation_ds), \
         patch.object(ai_service, "client", mock_client):
        await ai_service._create_completion_with_rotation(messages=MESSAGES, request_id="test-6")

    call_kwargs = mock_client.chat.completions.create.await_args.kwargs
    assert call_kwargs["extra_body"] == {"reasoning_effort": "low"}


@pytest.mark.asyncio
async def test_non_deepseek_model_has_no_reasoning_body(fresh_rotation: ModelRotation):
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(return_value=_make_response(MODEL_A))
            )
        )
    )

    with patch.object(ai_service, "rotation", fresh_rotation), \
         patch.object(ai_service, "client", mock_client):
        await ai_service._create_completion_with_rotation(messages=MESSAGES, request_id="test-7")

    call_kwargs = mock_client.chat.completions.create.await_args.kwargs
    assert "extra_body" not in call_kwargs
