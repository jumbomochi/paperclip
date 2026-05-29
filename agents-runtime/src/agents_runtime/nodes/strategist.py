from __future__ import annotations

import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("strategist")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


async def strategist_node(state: GraphState) -> GraphState:
    agent = load_agent("strategist")
    brief_id = state["brief_id"]
    user = (
        f"Brief id: {brief_id}\nTheme: {state.get('theme', '')}\n\n"
        "Return ONLY a JSON object with keys: "
        "audience, angle, platforms, suggested_hooks, key_points."
    )

    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.SMART,
        system=agent.system_prompt,
        user=user,
        max_tokens=1024,
        temperature=0.4,
    )
    try:
        plan = json.loads(result.text)
    except json.JSONDecodeError:
        log.error("strategist returned non-json", text=result.text[:200])
        raise

    async with _make_drafts_client() as drafts:
        await drafts.update_draft(id=brief_id, research=plan)

    return {**state, "research_done": False}
