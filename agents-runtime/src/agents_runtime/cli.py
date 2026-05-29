from __future__ import annotations

import asyncio

import click
import structlog
from dotenv import load_dotenv

from .graph import build_graph
from .mcp_clients import DraftsClient
from .nodes.analyst import run_daily_digest, run_weekly_digest

log = structlog.get_logger("cli")


@click.group()
def main() -> None:
    load_dotenv()


@main.command("run-week")
@click.argument("theme")
def run_week(theme: str) -> None:
    """Create a brief and run the full agency DAG end-to-end."""

    async def _do() -> None:
        async with DraftsClient() as drafts:
            brief = await drafts.create_draft(platform="x", status="briefed", body=theme)
        graph = build_graph()
        final = await graph.ainvoke({"brief_id": brief["id"], "theme": theme})
        log.info(
            "done",
            brief_id=brief["id"],
            drafted_x=len(final.get("drafted_x_ids", [])),
            drafted_linkedin=len(final.get("drafted_linkedin_ids", [])),
        )

    asyncio.run(_do())


@main.command("digest")
@click.option("--kind", type=click.Choice(["daily", "weekly"]), required=True)
def digest(kind: str) -> None:
    """Trigger an Analyst digest run."""
    asyncio.run(run_daily_digest() if kind == "daily" else run_weekly_digest())


@main.command("serve")
def serve() -> None:
    """Long-running dispatcher: polls Postgres + runs DAG for new briefs."""
    from .agent_runner import serve as runner_serve

    asyncio.run(runner_serve())
