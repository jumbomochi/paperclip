from __future__ import annotations

import json
from typing import Any

from .base import mcp_session


class AnalyticsClient:
    async def __aenter__(self) -> AnalyticsClient:
        self._cm = mcp_session("analytics-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def _call(self, name: str, args: dict[str, Any]) -> Any:
        result = await self._session.call_tool(name, args)
        if result.isError:
            raise RuntimeError(f"{name} failed: {result.content}")
        return json.loads(result.content[0].text)  # type: ignore[union-attr]

    async def top_hooks_last_n_days(self, *, days: int, limit: int = 5) -> list[dict[str, Any]]:
        return await self._call("topHooksLastNDays", {"days": days, "limit": limit})

    async def top_winners_by_platform(
        self, *, platform: str, days: int, limit: int = 5
    ) -> list[dict[str, Any]]:
        return await self._call(
            "topWinnersByPlatform", {"platform": platform, "days": days, "limit": limit}
        )

    async def write_digest(self, *, kind: str, content_md: str) -> dict[str, Any]:
        return await self._call("writeDigest", {"kind": kind, "contentMd": content_md})
