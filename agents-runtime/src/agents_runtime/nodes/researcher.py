from __future__ import annotations

import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient, ResearchClient, XClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("researcher")

ACCOUNT = "newsletter_main"


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


def _make_research_client() -> ResearchClient:
    return ResearchClient()


def _make_x_client() -> XClient:
    return XClient()


async def researcher_node(state: GraphState) -> GraphState:
    agent = load_agent("researcher")
    brief_id = state["brief_id"]

    async with _make_drafts_client() as drafts:
        brief = await drafts.get_draft(id=brief_id)
        if not brief:
            raise RuntimeError(f"brief not found: {brief_id}")

    plan = brief.get("research") or {}
    query_terms = (
        " ".join([plan.get("audience", ""), plan.get("angle", "")]).strip()
        or state.get("theme", "")
    )

    async with _make_research_client() as research:
        hn = await research.search_hacker_news(query=query_terms)
        reddit = await research.search_reddit(query=query_terms)

    async with _make_x_client() as x:
        try:
            x_posts = await x.search_top_posts(account=ACCOUNT, query=query_terms)
        except Exception as err:
            log.warning("x search failed", err=str(err))
            x_posts = []

    user = (
        f"Brief plan: {json.dumps(plan)}\n\n"
        f"HN top: {json.dumps(hn[:5])}\n"
        f"Reddit top: {json.dumps(reddit[:5])}\n"
        f"X top: {json.dumps(x_posts[:5])}\n\n"
        "Return JSON with keys: trends, top_posts, audience_notes, open_questions."
    )
    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=1024
    )
    blob = json.loads(result.text)

    async with _make_drafts_client() as drafts:
        await drafts.update_draft(id=brief_id, research={**plan, "findings": blob})
        await drafts.transition_status(
            draftId=brief_id, to="researched", actor="agent:researcher"
        )

    return {**state, "research_done": True}
