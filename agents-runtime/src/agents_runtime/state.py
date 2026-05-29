from __future__ import annotations

from typing import TypedDict


class GraphState(TypedDict, total=False):
    """LangGraph state for one brief running through the agency."""

    brief_id: str
    theme: str
    research_done: bool
    drafted_x_ids: list[str]
    drafted_linkedin_ids: list[str]
    editor_verdicts: dict[str, str]
    errors: list[str]
