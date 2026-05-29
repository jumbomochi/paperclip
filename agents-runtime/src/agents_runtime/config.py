from __future__ import annotations

import os
from functools import cache
from pathlib import Path

# Repo layout: agents-runtime/src/agents_runtime/config.py -> repo root is parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
AGENTS_DIR = REPO_ROOT / "agents"
POLICIES_DIR = REPO_ROOT / "policies"
MCP_DIR = REPO_ROOT / "mcp"


@cache
def database_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgres://paperclip:paperclip_dev@localhost:5434/paperclip",
    )
