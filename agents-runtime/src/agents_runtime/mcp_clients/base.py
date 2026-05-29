from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..config import MCP_DIR


@contextlib.asynccontextmanager
async def mcp_session(server_relpath: str) -> AsyncIterator[ClientSession]:
    """Spawn a TS MCP server (built into mcp/<name>/dist/server.js) and yield a session."""
    server_path = MCP_DIR / server_relpath
    if not server_path.exists():
        raise FileNotFoundError(
            f"MCP server not built: {server_path}. Run `pnpm -r build` first."
        )
    params = StdioServerParameters(command="node", args=[str(server_path)])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session
