from __future__ import annotations

import json
from typing import Any

from .base import mcp_session


class DraftsClient:
    async def __aenter__(self) -> DraftsClient:
        self._cm = mcp_session("drafts-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def _call(self, name: str, args: dict[str, Any]) -> Any:
        result = await self._session.call_tool(name, args)
        if result.isError:
            raise RuntimeError(f"{name} failed: {result.content}")
        text = result.content[0].text  # type: ignore[union-attr]
        return json.loads(text)

    async def create_draft(self, **kwargs: Any) -> dict[str, Any]:
        return await self._call("createDraft", kwargs)

    async def update_draft(self, **kwargs: Any) -> dict[str, Any]:
        return await self._call("updateDraft", kwargs)

    async def get_draft(self, *, id: str) -> dict[str, Any] | None:
        return await self._call("getDraft", {"id": id})

    async def list_by_status(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._call("listByStatus", kwargs)

    async def transition_status(self, **kwargs: Any) -> dict[str, Any]:
        return await self._call("transitionStatus", kwargs)
