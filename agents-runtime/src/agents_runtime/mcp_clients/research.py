from __future__ import annotations

import json
from typing import Any

from .base import mcp_session


class ResearchClient:
    async def __aenter__(self) -> ResearchClient:
        self._cm = mcp_session("research-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def _call(self, name: str, args: dict[str, Any]) -> Any:
        result = await self._session.call_tool(name, args)
        if result.isError:
            raise RuntimeError(f"{name} failed: {result.content}")
        return json.loads(result.content[0].text)  # type: ignore[union-attr]

    async def search_hacker_news(self, *, query: str) -> list[dict[str, Any]]:
        return await self._call("searchHackerNews", {"query": query})

    async def search_reddit(
        self, *, query: str, subreddit: str | None = None
    ) -> list[dict[str, Any]]:
        args: dict[str, Any] = {"query": query}
        if subreddit:
            args["subreddit"] = subreddit
        return await self._call("searchReddit", args)
