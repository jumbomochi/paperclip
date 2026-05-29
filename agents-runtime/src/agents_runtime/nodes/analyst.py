from __future__ import annotations

import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import AnalyticsClient
from ..prompts import load_agent

log = structlog.get_logger("analyst")


async def run_daily_digest() -> None:
    agent = load_agent("analyst")
    llm = LLM()
    async with AnalyticsClient() as analytics:
        winners_x = await analytics.top_winners_by_platform(platform="x", days=1, limit=10)
        winners_li = await analytics.top_winners_by_platform(
            platform="linkedin", days=1, limit=10
        )
        user = (
            f"Yesterday's posts:\nX: {json.dumps(winners_x)}\n"
            f"LinkedIn: {json.dumps(winners_li)}\n\n"
            "Write a daily digest as markdown (3-5 bullets)."
        )
        result = await llm.complete(
            tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=1024
        )
        await analytics.write_digest(kind="daily", content_md=result.text)


async def run_weekly_digest() -> None:
    agent = load_agent("analyst")
    llm = LLM()
    async with AnalyticsClient() as analytics:
        hooks = await analytics.top_hooks_last_n_days(days=7, limit=10)
        winners_x = await analytics.top_winners_by_platform(platform="x", days=7, limit=5)
        winners_li = await analytics.top_winners_by_platform(
            platform="linkedin", days=7, limit=5
        )
        user = (
            f"Hooks: {json.dumps(hooks)}\nX winners: {json.dumps(winners_x)}\n"
            f"LinkedIn winners: {json.dumps(winners_li)}\n\n"
            "Write a weekly leaderboard digest as markdown."
        )
        result = await llm.complete(
            tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=2048
        )
        await analytics.write_digest(kind="weekly", content_md=result.text)
