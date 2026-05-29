import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import strategist as strat
from agents_runtime.state import GraphState


class _Ctx:
    def __init__(self, value):
        self._v = value

    async def __aenter__(self):
        return self._v

    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_strategist_attaches_research_plan_to_brief(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {
                    "audience": "indie devs",
                    "angle": "test angle",
                    "platforms": ["x", "linkedin"],
                    "suggested_hooks": ["question-opener", "behind-the-scenes"],
                    "key_points": ["one", "two"],
                }
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.update_draft = AsyncMock(return_value={"id": "b1"})

    monkeypatch.setattr(strat, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(strat, "_make_drafts_client", lambda: _Ctx(fake_drafts))

    state: GraphState = {"brief_id": "b1", "theme": "Theme: AI marketing"}
    out = await strat.strategist_node(state)

    fake_llm.complete.assert_awaited_once()
    fake_drafts.update_draft.assert_awaited_once()
    call = fake_drafts.update_draft.await_args
    assert call.kwargs["id"] == "b1"
    assert "audience" in call.kwargs["research"]
    assert out["brief_id"] == "b1"
