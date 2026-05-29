import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import researcher as rs


class _Ctx:
    def __init__(self, value):
        self._v = value

    async def __aenter__(self):
        return self._v

    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_researcher_fills_research_and_transitions(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {"trends": ["t1"], "top_posts": [], "audience_notes": "n", "open_questions": []}
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(
        return_value={"id": "b1", "research": {"audience": "x", "angle": "y"}, "body": "theme"}
    )
    fake_drafts.update_draft = AsyncMock(return_value={"id": "b1"})
    fake_drafts.transition_status = AsyncMock(return_value={"id": "b1", "status": "researched"})
    fake_research = AsyncMock()
    fake_research.search_hacker_news = AsyncMock(return_value=[])
    fake_research.search_reddit = AsyncMock(return_value=[])
    fake_x = AsyncMock()
    fake_x.search_top_posts = AsyncMock(return_value=[])

    monkeypatch.setattr(rs, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(rs, "_make_drafts_client", lambda: _Ctx(fake_drafts))
    monkeypatch.setattr(rs, "_make_research_client", lambda: _Ctx(fake_research))
    monkeypatch.setattr(rs, "_make_x_client", lambda: _Ctx(fake_x))

    out = await rs.researcher_node({"brief_id": "b1", "theme": "x"})
    assert out["research_done"] is True
    fake_drafts.transition_status.assert_awaited_once()
