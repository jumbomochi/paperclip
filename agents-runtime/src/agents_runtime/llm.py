from __future__ import annotations

import json
import os
from dataclasses import dataclass
from enum import Enum

import httpx


class ModelTier(str, Enum):
    SMART = "smart"
    CHEAP = "cheap"


_MODELS: dict[ModelTier, str] = {
    ModelTier.SMART: "claude-opus-4-7",
    ModelTier.CHEAP: "claude-haiku-4-5-20251001",
}


@dataclass(frozen=True)
class CompletionResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int


class LLM:
    def __init__(self, *, base_url: str = "https://api.anthropic.com") -> None:
        self._base_url = base_url

    async def complete(
        self,
        *,
        tier: ModelTier,
        system: str,
        user: str,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> CompletionResult:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing")
        model = _MODELS[tier]
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self._base_url}/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "prompt-caching-2024-07-31",
                    "content-type": "application/json",
                },
                content=json.dumps(payload),
            )
            response.raise_for_status()
            body = response.json()
        text_blocks = [b["text"] for b in body["content"] if b["type"] == "text"]
        usage = body.get("usage", {})
        return CompletionResult(
            text="".join(text_blocks),
            model=body["model"],
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read_tokens=usage.get("cache_read_input_tokens", 0),
        )
