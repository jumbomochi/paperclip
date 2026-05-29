from __future__ import annotations

import asyncio

import asyncpg
import structlog

from .config import database_url
from .graph import build_graph

log = structlog.get_logger("agent_runner")

POLL_INTERVAL_SEC = 30
MAX_CONCURRENT = 2


async def _claim_pending(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        SELECT id, body FROM drafts
        WHERE status = 'briefed' AND (research->'_runtime_claimed') IS NULL
        ORDER BY created_at
        LIMIT 10
        """
    )


async def _mark_claimed(conn: asyncpg.Connection, brief_id: str) -> None:
    await conn.execute(
        """
        UPDATE drafts
        SET research = COALESCE(research, '{}'::jsonb)
                     || jsonb_build_object('_runtime_claimed', NOW()::text)
        WHERE id = $1
        """,
        brief_id,
    )


async def _run_one(graph, brief_id: str, theme: str) -> None:
    try:
        await graph.ainvoke({"brief_id": brief_id, "theme": theme})
        log.info("dag complete", brief_id=brief_id)
    except Exception as err:
        log.error("dag failed", brief_id=brief_id, err=str(err))


async def serve() -> None:
    log.info("agent_runner starting", poll_sec=POLL_INTERVAL_SEC, max_concurrent=MAX_CONCURRENT)
    graph = build_graph()
    pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=5)
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    try:
        while True:
            async with pool.acquire() as conn:
                rows = await _claim_pending(conn)
                claims: list[tuple[str, str]] = []
                for row in rows:
                    await _mark_claimed(conn, row["id"])
                    claims.append((str(row["id"]), row["body"]))

            async def gated_run(bid: str, theme: str) -> None:
                async with sem:
                    await _run_one(graph, bid, theme)

            await asyncio.gather(*(gated_run(bid, theme) for bid, theme in claims))
            await asyncio.sleep(POLL_INTERVAL_SEC)
    finally:
        await pool.close()
