import httpx
import pytest
import respx

from agents_runtime.llm import LLM, ModelTier


@pytest.mark.asyncio
async def test_smart_tier_uses_opus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    with respx.mock(base_url="https://api.anthropic.com") as router:
        router.post("/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-opus-4-7",
                    "content": [{"type": "text", "text": '{"ok": true}'}],
                    "stop_reason": "end_turn",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 5,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                    },
                },
            )
        )
        llm = LLM()
        result = await llm.complete(
            tier=ModelTier.SMART,
            system="You are X.",
            user="Do Y.",
        )
    assert result.text == '{"ok": true}'
    assert result.model == "claude-opus-4-7"


@pytest.mark.asyncio
async def test_system_prompt_is_cache_marked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    captured: dict[str, object] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "id": "x",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-4-7",
                "content": [{"type": "text", "text": "ok"}],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 1,
                    "output_tokens": 1,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            },
        )

    with respx.mock(base_url="https://api.anthropic.com") as router:
        router.post("/v1/messages").mock(side_effect=capture)
        llm = LLM()
        await llm.complete(tier=ModelTier.SMART, system="long prompt", user="hi")
    body = captured["body"].decode()
    assert "cache_control" in body
    assert "ephemeral" in body


@pytest.mark.asyncio
async def test_missing_api_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    llm = LLM()
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await llm.complete(tier=ModelTier.SMART, system="x", user="y")
