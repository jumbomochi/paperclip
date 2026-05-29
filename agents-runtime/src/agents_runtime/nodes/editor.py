from __future__ import annotations

import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("editor")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


async def editor_node(state: GraphState) -> GraphState:
    agent = load_agent("editor")
    drafts_ids = [*state.get("drafted_x_ids", []), *state.get("drafted_linkedin_ids", [])]
    verdicts: dict[str, str] = {}

    llm = _make_llm()
    async with _make_drafts_client() as drafts:
        for draft_id in drafts_ids:
            draft = await drafts.get_draft(id=draft_id)
            if not draft:
                continue
            await drafts.transition_status(
                draftId=draft_id, to="editor_review", actor="agent:editor"
            )
            user = (
                f"Draft (platform={draft['platform']}, "
                f"reworkCount={draft.get('reworkCount', 0)}):\n"
                f"{draft['body']}\n\n"
                "Return JSON per editor_rubric: verdict, scores, notes, suggested_edits."
            )
            result = await llm.complete(
                tier=ModelTier.SMART, system=agent.system_prompt, user=user, max_tokens=512
            )
            try:
                rubric = json.loads(result.text)
            except json.JSONDecodeError:
                log.error("editor non-json", draft_id=draft_id, text=result.text[:200])
                rubric = {"verdict": "editor_reject", "notes": "non-json output"}

            verdict = rubric.get("verdict", "editor_reject")
            verdicts[draft_id] = verdict

            await drafts.update_draft(id=draft_id, editorNotes=rubric)
            if verdict == "approve":
                target = "approval_queue"
            elif verdict == "rework" and draft.get("reworkCount", 0) < 2:
                target = "rework_requested"
            else:
                target = "editor_rejected"
            await drafts.transition_status(
                draftId=draft_id,
                to=target,
                actor="agent:editor",
                reason=rubric.get("notes", ""),
            )

    return {**state, "editor_verdicts": verdicts}
