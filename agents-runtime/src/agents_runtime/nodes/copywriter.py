from __future__ import annotations

import json
from typing import Literal

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import AnalyticsClient, DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("copywriter")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


def _make_analytics_client() -> AnalyticsClient:
    return AnalyticsClient()


async def _copywriter(state: GraphState, *, platform: Literal["x", "linkedin"]) -> GraphState:
    agent_id = f"copywriter_{platform}"
    agent = load_agent(agent_id)
    brief_id = state["brief_id"]

    async with _make_drafts_client() as drafts:
        brief = await drafts.get_draft(id=brief_id)
        if not brief:
            raise RuntimeError(f"brief not found: {brief_id}")

    async with _make_analytics_client() as analytics:
        winners = await analytics.top_winners_by_platform(platform=platform, days=28, limit=5)
        top_hooks = await analytics.top_hooks_last_n_days(days=28, limit=5)

    user = (
        f"Brief: {json.dumps(brief.get('research') or {})}\n\n"
        f"Voice anchors (top winners on {platform}): {json.dumps(winners)}\n"
        f"Top hooks: {json.dumps(top_hooks)}\n\n"
        "Return a JSON ARRAY of exactly 3 objects, each {hook_tag, body}."
    )
    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.SMART, system=agent.system_prompt, user=user, max_tokens=2048
    )
    variants = json.loads(result.text)
    if not isinstance(variants, list) or len(variants) != 3:
        raise ValueError(f"expected 3 variants, got {variants}")

    created: list[str] = []
    async with _make_drafts_client() as drafts:
        for v in variants:
            row = await drafts.create_draft(
                platform=platform,
                parentBriefId=brief_id,
                status="drafted",
                hookTag=v["hook_tag"],
                body=v["body"],
            )
            created.append(row["id"])

    key = "drafted_x_ids" if platform == "x" else "drafted_linkedin_ids"
    return {**state, key: created}


async def copywriter_x_node(state: GraphState) -> GraphState:
    return await _copywriter(state, platform="x")


async def copywriter_linkedin_node(state: GraphState) -> GraphState:
    return await _copywriter(state, platform="linkedin")
