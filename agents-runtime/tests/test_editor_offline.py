import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import editor as ed
from agents_runtime.state import GraphState


class _Ctx:
    def __init__(self, value):
        self._v = value

    async def __aenter__(self):
        return self._v

    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_editor_approves_clean_drafts(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {
                    "verdict": "approve",
                    "scores": {"HARD_VOICE": True},
                    "notes": "looks good",
                    "suggested_edits": None,
                }
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(
        return_value={"id": "v1", "platform": "x", "body": "b", "reworkCount": 0}
    )
    fake_drafts.update_draft = AsyncMock()
    fake_drafts.transition_status = AsyncMock(return_value={"id": "v1", "status": "approval_queue"})

    monkeypatch.setattr(ed, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(ed, "_make_drafts_client", lambda: _Ctx(fake_drafts))

    state: GraphState = {
        "brief_id": "b1",
        "drafted_x_ids": ["v1"],
        "drafted_linkedin_ids": [],
    }
    out = await ed.editor_node(state)
    assert out["editor_verdicts"]["v1"] == "approve"
    transitions = [c.kwargs["to"] for c in fake_drafts.transition_status.await_args_list]
    assert transitions == ["editor_review", "approval_queue"]
