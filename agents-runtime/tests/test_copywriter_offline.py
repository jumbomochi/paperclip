import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import copywriter as cw


class _Ctx:
    def __init__(self, value):
        self._v = value

    async def __aenter__(self):
        return self._v

    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_copywriter_x_creates_three_drafts(monkeypatch: pytest.MonkeyPatch) -> None:
    variants = [
        {"hook_tag": "question-opener", "body": "a https://news.example.com"},
        {"hook_tag": "bold-claim", "body": "b https://news.example.com"},
        {"hook_tag": "behind-the-scenes", "body": "c https://news.example.com"},
    ]
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(return_value=MagicMock(text=json.dumps(variants)))

    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(
        return_value={"id": "b1", "research": {"audience": "x", "findings": {}}, "body": "t"}
    )
    fake_drafts.create_draft = AsyncMock(side_effect=[{"id": f"v{i}"} for i in range(3)])
    fake_analytics = AsyncMock()
    fake_analytics.top_winners_by_platform = AsyncMock(return_value=[])
    fake_analytics.top_hooks_last_n_days = AsyncMock(return_value=[])

    monkeypatch.setattr(cw, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(cw, "_make_drafts_client", lambda: _Ctx(fake_drafts))
    monkeypatch.setattr(cw, "_make_analytics_client", lambda: _Ctx(fake_analytics))

    out = await cw.copywriter_x_node({"brief_id": "b1"})
    assert len(out["drafted_x_ids"]) == 3
    assert fake_drafts.create_draft.await_count == 3
