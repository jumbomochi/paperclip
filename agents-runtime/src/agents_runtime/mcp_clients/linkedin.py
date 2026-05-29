from __future__ import annotations

import json
from typing import Any

from .base import mcp_session


class LinkedInClient:
    async def __aenter__(self) -> LinkedInClient:
        self._cm = mcp_session("linkedin-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def search_top_posts(self, *, account: str, query: str) -> list[dict[str, Any]]:
        result = await self._session.call_tool(
            "searchTopPosts", {"account": account, "query": query}
        )
        if result.isError:
            return []  # graceful degradation matches the TS contract
        return json.loads(result.content[0].text)  # type: ignore[union-attr]
