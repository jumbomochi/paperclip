import os

import pytest

from agents_runtime.mcp_clients.drafts import DraftsClient

pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_MCP_INTEGRATION") == "1",
    reason="needs built TS MCP servers + running Postgres",
)


@pytest.mark.asyncio
async def test_drafts_round_trip() -> None:
    async with DraftsClient() as drafts:
        created = await drafts.create_draft(platform="x", body="hello from py", status="briefed")
        assert created["platform"] == "x"
        assert created["status"] == "briefed"

        got = await drafts.get_draft(id=created["id"])
        assert got is not None
        assert got["id"] == created["id"]

        transitioned = await drafts.transition_status(
            draftId=created["id"],
            to="researched",
            actor="test:py",
        )
        assert transitioned["status"] == "researched"
