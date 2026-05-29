# Plan 7 — LangGraph Hybrid Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Paperclip as the agent orchestration runtime with a Python LangGraph agent layer, while keeping the existing TS web shell, MCP servers, workers, and Postgres schema unchanged. After this ships, the agency runs end-to-end with real LLMs: `uv run paperclip-agents run-week "<theme>"` produces real drafts in `/queue`, the scheduler posts approved X drafts, attribution closes the loop — and Paperclip the product is no longer a dependency.

**Architecture:** A new Python package `agents-runtime/` defines a LangGraph DAG with one node per agent role. Each node loads its system prompt from `agents/*.yaml` (with `{{policy:NAME}}` markers resolved against `policies/*.md`), calls Anthropic with prompt caching, and reads/writes drafts via stdio MCP subprocess clients pointed at the existing TS MCP servers (`@paperclip/drafts-mcp`, `/x-mcp`, `/linkedin-mcp`, `/research-mcp`, `/analytics-mcp`). LangGraph state is ephemeral; the durable state lives in Postgres on the existing `drafts.status` state machine. A new long-running worker (`agents-runtime/agent_runner.py`) polls Postgres and dispatches subgraphs per brief; the existing `workers/scheduler` still owns the post action.

**Tech Stack:** Python 3.13 + uv + LangGraph (Python) + Anthropic SDK + mcp (Python client) + asyncpg + Pydantic + PyYAML + pytest + structlog. TS stack (Next.js, MCP servers, workers, Drizzle) stays as-is.

**Depends on:** Plans 1-6 complete. **Replaces** Paperclip-specific elements of Plan 4 (paperclip-config/, Paperclip submodule, Dockerfile.paperclip).

---

## File Structure

```
paperclip/
├── agents-runtime/                           # NEW Python package
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── README.md
│   ├── src/agents_runtime/
│   │   ├── __init__.py
│   │   ├── config.py                         # env loading, paths
│   │   ├── prompts.py                        # YAML+policy loader
│   │   ├── llm.py                            # Anthropic client w/ prompt caching
│   │   ├── state.py                          # Pydantic graph state
│   │   ├── graph.py                          # LangGraph DAG definition
│   │   ├── nodes/
│   │   │   ├── __init__.py
│   │   │   ├── strategist.py
│   │   │   ├── researcher.py
│   │   │   ├── copywriter.py                 # parameterized for X | LinkedIn
│   │   │   ├── editor.py
│   │   │   └── analyst.py
│   │   ├── mcp_clients/                      # stdio clients per TS MCP
│   │   │   ├── __init__.py
│   │   │   ├── base.py                       # spawn + lifecycle
│   │   │   ├── drafts.py
│   │   │   ├── x.py
│   │   │   ├── linkedin.py
│   │   │   ├── research.py
│   │   │   └── analytics.py
│   │   ├── agent_runner.py                   # long-running dispatcher worker
│   │   └── cli.py                            # uv-run entrypoints
│   └── tests/
│       ├── test_prompts.py
│       ├── test_llm.py
│       ├── test_mcp_drafts.py
│       ├── test_graph_shape.py
│       └── test_strategist_offline.py
├── .python-version                           # 3.13
├── .github/workflows/
│   └── ci.yml                                # NEW: TS + Python lanes
├── infra/
│   └── docker-compose.yml                    # +agent-runner service (Python image)
├── (DELETED) paperclip-config/
├── (DELETED) scripts/stub-agents/            # superseded by Python run_week CLI
├── README.md                                 # updated: remove Paperclip-vendor steps
└── docs/superpowers/plans/2026-05-29-plan-7-langgraph-hybrid.md
```

**Key boundaries:**

- `agents-runtime/` is the *only* place LLM calls happen. MCP servers stay deterministic.
- Each MCP subprocess is spawned at graph-run start, kept alive across all node visits, terminated at graph-run end. The `base.py` client wraps lifetime + asyncio task management.
- Graph state holds only IDs + accumulated metadata. The *content* (drafts, research blobs) lives in Postgres — reachable via drafts-mcp on each node visit. This keeps the graph cheap to checkpoint and resumable on crash.
- The `agent_runner.py` worker is the *only* long-running Python process in v1. The TS workers (`scheduler`, `metrics-collector`, `notifier`, `cost-watchdog`) stay TS.

---

### Task 1: Add Python tooling — uv project + pyproject.toml + .python-version

**Files:**
- Create: `.python-version`
- Create: `agents-runtime/pyproject.toml`
- Create: `agents-runtime/README.md`

- [ ] **Step 1: Pin Python version**

```bash
echo "3.13" > .python-version
```

- [ ] **Step 2: Write `agents-runtime/pyproject.toml`**

```toml
[project]
name = "agents-runtime"
version = "0.0.0"
description = "LangGraph agent runtime for Paperclip newsletter marketing agency"
readme = "README.md"
requires-python = ">=3.13"
dependencies = [
    "langgraph>=0.2.50",
    "anthropic>=0.40.0",
    "mcp>=1.0.0",
    "asyncpg>=0.30.0",
    "pydantic>=2.9",
    "pyyaml>=6.0",
    "structlog>=24.4",
    "click>=8.1",
    "python-dotenv>=1.0",
]

[project.scripts]
paperclip-agents = "agents_runtime.cli:main"

[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "ruff>=0.7",
    "mypy>=1.13",
    "respx>=0.21",
]

[tool.uv]
package = true

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/agents_runtime"]

[tool.ruff]
line-length = 100
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "C4", "ASYNC"]

[tool.mypy]
python_version = "3.13"
strict = true
warn_return_any = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: Write `agents-runtime/README.md`**

```markdown
# agents-runtime

Python LangGraph agent runtime. Replaces Paperclip as the orchestration layer for the newsletter marketing agency.

## Setup

```bash
cd agents-runtime
uv sync
cp ../.env.example ../.env   # fill in ANTHROPIC_API_KEY, TOKEN_ENC_KEY, etc.
uv run pytest
```

## Run

```bash
# Manual brief — runs the full DAG end-to-end:
uv run paperclip-agents run-week "Theme: shipping the first autonomous marketing agency"

# Long-running dispatcher — polls Postgres for drafts in agent-driven states:
uv run paperclip-agents serve
```

## Architecture

State machine in Postgres (`drafts.status`) drives the dispatcher. For each brief, a LangGraph DAG runs:

```
START → strategist → researcher → [copywriter_x, copywriter_linkedin] → editor → END
```

Each node spawns MCP stdio subprocesses pointed at the existing TS servers under `mcp/*/dist/server.js`.
```

- [ ] **Step 4: Verify uv works**

```bash
cd agents-runtime && uv sync 2>&1 | tail -5
```
Expected: lockfile created, dependencies resolved.

- [ ] **Step 5: Commit**

```bash
git add .python-version agents-runtime/pyproject.toml agents-runtime/README.md agents-runtime/uv.lock
git commit -m "chore(agents-runtime): scaffold Python package with uv + pyproject"
```

---

### Task 2: Prompts loader — YAML agents + policy templating (TDD)

**Files:**
- Create: `agents-runtime/src/agents_runtime/__init__.py`
- Create: `agents-runtime/src/agents_runtime/config.py`
- Create: `agents-runtime/src/agents_runtime/prompts.py`
- Create: `agents-runtime/tests/test_prompts.py`
- Create: `agents-runtime/tests/__init__.py`

- [ ] **Step 1: Write `config.py`**

```python
from __future__ import annotations
from pathlib import Path
from functools import cache

# Repo layout: agents-runtime/src/agents_runtime/config.py -> repo root is parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
AGENTS_DIR = REPO_ROOT / "agents"
POLICIES_DIR = REPO_ROOT / "policies"
MCP_DIR = REPO_ROOT / "mcp"


@cache
def database_url() -> str:
    import os
    return os.environ.get(
        "DATABASE_URL",
        "postgres://paperclip:paperclip_dev@localhost:5434/paperclip",
    )
```

- [ ] **Step 2: Failing test `agents-runtime/tests/test_prompts.py`**

```python
import textwrap
from pathlib import Path

import pytest

from agents_runtime.prompts import load_agent, resolve_policies


def test_load_agent_returns_id_and_prompt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agents_dir = tmp_path / "agents"
    policies_dir = tmp_path / "policies"
    agents_dir.mkdir()
    policies_dir.mkdir()
    (agents_dir / "demo.yaml").write_text(textwrap.dedent("""
        id: demo
        name: Demo
        model: smart
        system_prompt: |
          Hello.
          Follow {{policy:brand_voice}}.
    """))
    (policies_dir / "brand_voice.md").write_text("Be warm.")

    monkeypatch.setattr("agents_runtime.prompts.AGENTS_DIR", agents_dir)
    monkeypatch.setattr("agents_runtime.prompts.POLICIES_DIR", policies_dir)

    agent = load_agent("demo")
    assert agent.id == "demo"
    assert "Hello." in agent.system_prompt
    assert "Be warm." in agent.system_prompt
    assert "{{policy:brand_voice}}" not in agent.system_prompt


def test_unknown_policy_marker_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agents_dir = tmp_path / "agents"
    policies_dir = tmp_path / "policies"
    agents_dir.mkdir()
    policies_dir.mkdir()
    (agents_dir / "demo.yaml").write_text("id: demo\nname: Demo\nmodel: smart\nsystem_prompt: |\n  uses {{policy:missing}}\n")

    monkeypatch.setattr("agents_runtime.prompts.AGENTS_DIR", agents_dir)
    monkeypatch.setattr("agents_runtime.prompts.POLICIES_DIR", policies_dir)

    with pytest.raises(KeyError, match="missing"):
        load_agent("demo")


def test_resolve_policies_is_idempotent() -> None:
    resolved = resolve_policies("no markers here", policies={"brand_voice": "x"})
    assert resolved == "no markers here"
```

- [ ] **Step 3: Run, expect failure**

```bash
cd agents-runtime && uv run pytest tests/test_prompts.py -v
```

- [ ] **Step 4: Implement `prompts.py`**

```python
from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from .config import AGENTS_DIR, POLICIES_DIR

POLICY_MARKER = re.compile(r"\{\{policy:([a-z_][a-z0-9_]*)\}\}")


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    model: str
    system_prompt: str
    raw: dict


def _load_policies() -> dict[str, str]:
    return {p.stem: p.read_text() for p in POLICIES_DIR.glob("*.md") if p.stem != "readme"}


def resolve_policies(text: str, policies: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in policies:
            raise KeyError(name)
        return policies[name]

    return POLICY_MARKER.sub(replace, text)


def load_agent(agent_id: str) -> Agent:
    path = AGENTS_DIR / f"{agent_id}.yaml"
    raw = yaml.safe_load(path.read_text())
    policies = _load_policies()
    resolved = resolve_policies(raw["system_prompt"], policies)
    return Agent(
        id=raw["id"],
        name=raw["name"],
        model=raw["model"],
        system_prompt=resolved,
        raw=raw,
    )
```

- [ ] **Step 5: Write `__init__.py` files**

```python
# agents-runtime/src/agents_runtime/__init__.py
__all__: list[str] = []
```

```python
# agents-runtime/tests/__init__.py
```

- [ ] **Step 6: Run, expect pass**

```bash
cd agents-runtime && uv run pytest tests/test_prompts.py -v
```
Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add agents-runtime/
git commit -m "feat(agents-runtime): YAML agent loader with policy templating"
```

---

### Task 3: Anthropic LLM client with prompt caching (TDD with respx)

**Files:**
- Create: `agents-runtime/src/agents_runtime/llm.py`
- Create: `agents-runtime/tests/test_llm.py`

- [ ] **Step 1: Failing test**

```python
# agents-runtime/tests/test_llm.py
import httpx
import pytest
import respx

from agents_runtime.llm import LLM, ModelTier


@pytest.fixture
def respx_mock() -> respx.MockRouter:
    with respx.mock(base_url="https://api.anthropic.com") as router:
        yield router


@pytest.mark.asyncio
async def test_smart_tier_uses_opus(respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    respx_mock.post("/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-4-7",
                "content": [{"type": "text", "text": '{"ok": true}'}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 100, "output_tokens": 5, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            },
        )
    )
    llm = LLM()
    result = await llm.complete(
        tier=ModelTier.SMART,
        system="You are X.",
        user="Do Y.",
    )
    assert result.text == '{"ok": true}'
    assert result.model == "claude-opus-4-7"


@pytest.mark.asyncio
async def test_system_prompt_is_cache_marked(respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    captured: dict[str, object] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "id": "x",
                "type": "message",
                "role": "assistant",
                "model": "claude-opus-4-7",
                "content": [{"type": "text", "text": "ok"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 1, "output_tokens": 1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            },
        )

    respx_mock.post("/v1/messages").mock(side_effect=capture)
    llm = LLM()
    await llm.complete(tier=ModelTier.SMART, system="long prompt", user="hi")
    body = captured["body"].decode()
    assert "cache_control" in body
    assert "ephemeral" in body
```

- [ ] **Step 2: Implement `llm.py`**

```python
from __future__ import annotations
import json
import os
from dataclasses import dataclass
from enum import Enum

import httpx

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"


class ModelTier(str, Enum):
    SMART = "smart"
    CHEAP = "cheap"


_MODELS: dict[ModelTier, str] = {
    ModelTier.SMART: "claude-opus-4-7",
    ModelTier.CHEAP: "claude-haiku-4-5-20251001",
}


@dataclass(frozen=True)
class CompletionResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int


class LLM:
    def __init__(self, *, base_url: str = "https://api.anthropic.com") -> None:
        self._base_url = base_url

    async def complete(
        self,
        *,
        tier: ModelTier,
        system: str,
        user: str,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> CompletionResult:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing")
        model = _MODELS[tier]
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self._base_url}/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "prompt-caching-2024-07-31",
                    "content-type": "application/json",
                },
                content=json.dumps(payload),
            )
            response.raise_for_status()
            body = response.json()
        text_blocks = [b["text"] for b in body["content"] if b["type"] == "text"]
        usage = body.get("usage", {})
        return CompletionResult(
            text="".join(text_blocks),
            model=body["model"],
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read_tokens=usage.get("cache_read_input_tokens", 0),
        )
```

- [ ] **Step 3: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_llm.py -v
git add agents-runtime/src/agents_runtime/llm.py agents-runtime/tests/test_llm.py
git commit -m "feat(agents-runtime): Anthropic LLM client with prompt-cache ephemeral marker"
```

---

### Task 4: MCP stdio client base + drafts client (TDD)

**Files:**
- Create: `agents-runtime/src/agents_runtime/mcp_clients/__init__.py`
- Create: `agents-runtime/src/agents_runtime/mcp_clients/base.py`
- Create: `agents-runtime/src/agents_runtime/mcp_clients/drafts.py`
- Create: `agents-runtime/tests/test_mcp_drafts.py`

> **Note:** This task assumes the TS MCP servers are built (`pnpm -r build`). If not, run that first.

- [ ] **Step 1: `mcp_clients/__init__.py`**

```python
from .drafts import DraftsClient

__all__ = ["DraftsClient"]
```

- [ ] **Step 2: `mcp_clients/base.py`**

```python
from __future__ import annotations
import asyncio
import contextlib
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..config import MCP_DIR


@contextlib.asynccontextmanager
async def mcp_session(server_relpath: str):
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
```

- [ ] **Step 3: Failing test `tests/test_mcp_drafts.py`**

```python
import json
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
            draft_id=created["id"],
            to="researched",
            actor="test:py",
        )
        assert transitioned["status"] == "researched"
```

- [ ] **Step 4: Implement `mcp_clients/drafts.py`**

```python
from __future__ import annotations
import json
from typing import Any

from .base import mcp_session


class DraftsClient:
    async def __aenter__(self) -> "DraftsClient":
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
```

- [ ] **Step 5: Run integration test**

```bash
pnpm -r build                          # ensure dist/server.js exists
cd agents-runtime && uv run pytest tests/test_mcp_drafts.py -v
```
Expected: PASS (or skip if `SKIP_MCP_INTEGRATION=1`).

- [ ] **Step 6: Commit**

```bash
git add agents-runtime/src/agents_runtime/mcp_clients/ agents-runtime/tests/test_mcp_drafts.py
git commit -m "feat(agents-runtime): drafts-mcp stdio client + round-trip test"
```

---

### Task 5: Remaining MCP clients — x, linkedin, research, analytics

**Files:**
- Create: `agents-runtime/src/agents_runtime/mcp_clients/x.py`
- Create: `agents-runtime/src/agents_runtime/mcp_clients/linkedin.py`
- Create: `agents-runtime/src/agents_runtime/mcp_clients/research.py`
- Create: `agents-runtime/src/agents_runtime/mcp_clients/analytics.py`
- Modify: `agents-runtime/src/agents_runtime/mcp_clients/__init__.py`

- [ ] **Step 1: `mcp_clients/x.py`** (read-only methods only — Scheduler still owns writes)

```python
from __future__ import annotations
import json
from typing import Any

from .base import mcp_session


class XClient:
    async def __aenter__(self) -> "XClient":
        self._cm = mcp_session("x-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def _call(self, name: str, args: dict[str, Any]) -> Any:
        result = await self._session.call_tool(name, args)
        if result.isError:
            raise RuntimeError(f"{name} failed: {result.content}")
        return json.loads(result.content[0].text)  # type: ignore[union-attr]

    async def search_top_posts(self, *, account: str, query: str) -> list[dict[str, Any]]:
        return await self._call("searchTopPosts", {"account": account, "query": query})
```

- [ ] **Step 2: `mcp_clients/linkedin.py`**

```python
from __future__ import annotations
import json
from typing import Any

from .base import mcp_session


class LinkedInClient:
    async def __aenter__(self) -> "LinkedInClient":
        self._cm = mcp_session("linkedin-mcp/dist/server.js")
        self._session = await self._cm.__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self._cm.__aexit__(*exc_info)

    async def search_top_posts(self, *, account: str, query: str) -> list[dict[str, Any]]:
        result = await self._session.call_tool("searchTopPosts", {"account": account, "query": query})
        if result.isError:
            return []  # graceful degradation matches the TS contract
        return json.loads(result.content[0].text)  # type: ignore[union-attr]
```

- [ ] **Step 3: `mcp_clients/research.py`**

```python
from __future__ import annotations
import json
from typing import Any

from .base import mcp_session


class ResearchClient:
    async def __aenter__(self) -> "ResearchClient":
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

    async def search_reddit(self, *, query: str, subreddit: str | None = None) -> list[dict[str, Any]]:
        args: dict[str, Any] = {"query": query}
        if subreddit:
            args["subreddit"] = subreddit
        return await self._call("searchReddit", args)
```

- [ ] **Step 4: `mcp_clients/analytics.py`**

```python
from __future__ import annotations
import json
from typing import Any

from .base import mcp_session


class AnalyticsClient:
    async def __aenter__(self) -> "AnalyticsClient":
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

    async def top_winners_by_platform(self, *, platform: str, days: int, limit: int = 5) -> list[dict[str, Any]]:
        return await self._call(
            "topWinnersByPlatform", {"platform": platform, "days": days, "limit": limit}
        )

    async def write_digest(self, *, kind: str, content_md: str) -> dict[str, Any]:
        return await self._call("writeDigest", {"kind": kind, "contentMd": content_md})
```

- [ ] **Step 5: Update `__init__.py`**

```python
from .analytics import AnalyticsClient
from .drafts import DraftsClient
from .linkedin import LinkedInClient
from .research import ResearchClient
from .x import XClient

__all__ = ["AnalyticsClient", "DraftsClient", "LinkedInClient", "ResearchClient", "XClient"]
```

- [ ] **Step 6: Commit**

```bash
git add agents-runtime/src/agents_runtime/mcp_clients/
git commit -m "feat(agents-runtime): MCP clients for x, linkedin, research, analytics"
```

---

### Task 6: Graph state + DAG shape

**Files:**
- Create: `agents-runtime/src/agents_runtime/state.py`
- Create: `agents-runtime/src/agents_runtime/graph.py`
- Create: `agents-runtime/tests/test_graph_shape.py`

- [ ] **Step 1: `state.py`**

```python
from __future__ import annotations
from typing import TypedDict


class GraphState(TypedDict, total=False):
    """LangGraph state for one brief running through the agency."""
    brief_id: str
    theme: str
    research_done: bool
    drafted_x_ids: list[str]
    drafted_linkedin_ids: list[str]
    editor_verdicts: dict[str, str]  # draft_id -> verdict
    errors: list[str]
```

- [ ] **Step 2: `graph.py` skeleton**

```python
from __future__ import annotations
from langgraph.graph import StateGraph, START, END

from .nodes.copywriter import copywriter_linkedin_node, copywriter_x_node
from .nodes.editor import editor_node
from .nodes.researcher import researcher_node
from .nodes.strategist import strategist_node
from .state import GraphState


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("strategist", strategist_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("copywriter_x", copywriter_x_node)
    graph.add_node("copywriter_linkedin", copywriter_linkedin_node)
    graph.add_node("editor", editor_node)

    graph.add_edge(START, "strategist")
    graph.add_edge("strategist", "researcher")
    # Fan-out:
    graph.add_edge("researcher", "copywriter_x")
    graph.add_edge("researcher", "copywriter_linkedin")
    # Fan-in to editor (LangGraph joins at the next named node):
    graph.add_edge("copywriter_x", "editor")
    graph.add_edge("copywriter_linkedin", "editor")
    graph.add_edge("editor", END)

    return graph.compile()
```

- [ ] **Step 3: Failing test `tests/test_graph_shape.py`**

```python
def test_graph_compiles_with_expected_nodes() -> None:
    from agents_runtime.graph import build_graph
    compiled = build_graph()
    nodes = set(compiled.get_graph().nodes.keys())
    assert {"strategist", "researcher", "copywriter_x", "copywriter_linkedin", "editor"} <= nodes
```

- [ ] **Step 4: Create stub node modules so import resolves**

```python
# agents-runtime/src/agents_runtime/nodes/__init__.py
```

```python
# agents-runtime/src/agents_runtime/nodes/strategist.py
from ..state import GraphState

async def strategist_node(state: GraphState) -> GraphState:
    raise NotImplementedError("implemented in Task 7")
```

Repeat for `researcher.py`, `copywriter.py` (with `copywriter_x_node` and `copywriter_linkedin_node`), `editor.py`, `analyst.py` — each just `raise NotImplementedError`.

Specifically for `copywriter.py`:
```python
from ..state import GraphState

async def copywriter_x_node(state: GraphState) -> GraphState:
    raise NotImplementedError("implemented in Task 9")

async def copywriter_linkedin_node(state: GraphState) -> GraphState:
    raise NotImplementedError("implemented in Task 9")
```

- [ ] **Step 5: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_graph_shape.py -v
git add agents-runtime/
git commit -m "feat(agents-runtime): graph shape with stub nodes (compiles, runs blank)"
```

---

### Task 7: Strategist node (TDD with mocked LLM + drafts client)

**Files:**
- Modify: `agents-runtime/src/agents_runtime/nodes/strategist.py`
- Create: `agents-runtime/tests/test_strategist_offline.py`

- [ ] **Step 1: Failing test (uses fakes — no real LLM, no real MCP)**

```python
# agents-runtime/tests/test_strategist_offline.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import strategist as strat
from agents_runtime.state import GraphState


@pytest.mark.asyncio
async def test_strategist_attaches_research_plan_to_brief(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {
                    "audience": "indie devs",
                    "angle": "test angle",
                    "platforms": ["x", "linkedin"],
                    "suggested_hooks": ["question-opener", "behind-the-scenes"],
                    "key_points": ["one", "two"],
                }
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.update_draft = AsyncMock(return_value={"id": "b1"})

    monkeypatch.setattr(strat, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(strat, "_make_drafts_client", lambda: _ctxmgr(fake_drafts))

    state: GraphState = {"brief_id": "b1", "theme": "Theme: AI marketing"}
    out = await strat.strategist_node(state)

    fake_llm.complete.assert_awaited_once()
    fake_drafts.update_draft.assert_awaited_once()
    call = fake_drafts.update_draft.await_args
    assert call.kwargs["id"] == "b1"
    assert "audience" in call.kwargs["research"]
    assert out["brief_id"] == "b1"


# helper: turn an AsyncMock into an async context manager that yields it
class _ctxmgr:
    def __init__(self, value):
        self._v = value
    async def __aenter__(self):
        return self._v
    async def __aexit__(self, *a):
        return None
```

- [ ] **Step 2: Implement `strategist.py`**

```python
from __future__ import annotations
import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("strategist")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client():
    return DraftsClient()


async def strategist_node(state: GraphState) -> GraphState:
    agent = load_agent("strategist")
    brief_id = state["brief_id"]
    user = f"Brief id: {brief_id}\nTheme: {state.get('theme', '')}\n\nReturn ONLY a JSON object with keys: audience, angle, platforms, suggested_hooks, key_points."

    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.SMART,
        system=agent.system_prompt,
        user=user,
        max_tokens=1024,
        temperature=0.4,
    )
    try:
        plan = json.loads(result.text)
    except json.JSONDecodeError:
        log.error("strategist returned non-json", text=result.text[:200])
        raise

    async with _make_drafts_client() as drafts:
        await drafts.update_draft(id=brief_id, research=plan)

    return {**state, "research_done": False}
```

- [ ] **Step 3: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_strategist_offline.py -v
git add agents-runtime/src/agents_runtime/nodes/strategist.py agents-runtime/tests/test_strategist_offline.py
git commit -m "feat(agents-runtime): strategist node — attaches refined plan to brief"
```

---

### Task 8: Researcher node

**Files:**
- Modify: `agents-runtime/src/agents_runtime/nodes/researcher.py`
- Create: `agents-runtime/tests/test_researcher_offline.py`

> **Pattern matches Task 7.** The Researcher reads the brief, queries `research-mcp` (HN + Reddit) and `x-mcp.searchTopPosts`, distills results via cheap-tier LLM, calls `drafts.update_draft` with the research blob, then `drafts.transition_status` brief: briefed → researched.

- [ ] **Step 1: Failing test**

```python
# agents-runtime/tests/test_researcher_offline.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import researcher as rs
from agents_runtime.state import GraphState


class _Ctx:
    def __init__(self, value):
        self._v = value
    async def __aenter__(self):
        return self._v
    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_researcher_fills_research_and_transitions(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {"trends": ["t1"], "top_posts": [], "audience_notes": "n", "open_questions": []}
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(
        return_value={"id": "b1", "research": {"audience": "x", "angle": "y"}, "body": "theme"}
    )
    fake_drafts.update_draft = AsyncMock(return_value={"id": "b1"})
    fake_drafts.transition_status = AsyncMock(return_value={"id": "b1", "status": "researched"})
    fake_research = AsyncMock()
    fake_research.search_hacker_news = AsyncMock(return_value=[])
    fake_research.search_reddit = AsyncMock(return_value=[])
    fake_x = AsyncMock()
    fake_x.search_top_posts = AsyncMock(return_value=[])

    monkeypatch.setattr(rs, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(rs, "_make_drafts_client", lambda: _Ctx(fake_drafts))
    monkeypatch.setattr(rs, "_make_research_client", lambda: _Ctx(fake_research))
    monkeypatch.setattr(rs, "_make_x_client", lambda: _Ctx(fake_x))

    out = await rs.researcher_node({"brief_id": "b1", "theme": "x"})
    assert out["research_done"] is True
    fake_drafts.transition_status.assert_awaited_once()
```

- [ ] **Step 2: Implement `researcher.py`**

```python
from __future__ import annotations
import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient, ResearchClient, XClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("researcher")

ACCOUNT = "newsletter_main"


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


def _make_research_client() -> ResearchClient:
    return ResearchClient()


def _make_x_client() -> XClient:
    return XClient()


async def researcher_node(state: GraphState) -> GraphState:
    agent = load_agent("researcher")
    brief_id = state["brief_id"]

    async with _make_drafts_client() as drafts:
        brief = await drafts.get_draft(id=brief_id)
        if not brief:
            raise RuntimeError(f"brief not found: {brief_id}")

    plan = brief.get("research") or {}
    query_terms = " ".join([plan.get("audience", ""), plan.get("angle", "")]).strip() or state.get("theme", "")

    async with _make_research_client() as research:
        hn = await research.search_hacker_news(query=query_terms)
        reddit = await research.search_reddit(query=query_terms)

    async with _make_x_client() as x:
        try:
            x_posts = await x.search_top_posts(account=ACCOUNT, query=query_terms)
        except Exception as err:
            log.warning("x search failed", err=str(err))
            x_posts = []

    user = (
        f"Brief plan: {json.dumps(plan)}\n\n"
        f"HN top: {json.dumps(hn[:5])}\n"
        f"Reddit top: {json.dumps(reddit[:5])}\n"
        f"X top: {json.dumps(x_posts[:5])}\n\n"
        "Return JSON with keys: trends, top_posts, audience_notes, open_questions."
    )
    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=1024
    )
    blob = json.loads(result.text)

    async with _make_drafts_client() as drafts:
        await drafts.update_draft(id=brief_id, research={**plan, "findings": blob})
        await drafts.transition_status(
            draft_id=brief_id, to="researched", actor="agent:researcher"
        )

    return {**state, "research_done": True}
```

- [ ] **Step 3: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_researcher_offline.py -v
git add agents-runtime/src/agents_runtime/nodes/researcher.py agents-runtime/tests/test_researcher_offline.py
git commit -m "feat(agents-runtime): researcher node — fills research blob, transitions brief"
```

---

### Task 9: Copywriter nodes (X + LinkedIn) — parameterized factory

**Files:**
- Modify: `agents-runtime/src/agents_runtime/nodes/copywriter.py`
- Create: `agents-runtime/tests/test_copywriter_offline.py`

- [ ] **Step 1: Failing test**

```python
# agents-runtime/tests/test_copywriter_offline.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import copywriter as cw
from agents_runtime.state import GraphState


class _Ctx:
    def __init__(self, value):
        self._v = value
    async def __aenter__(self):
        return self._v
    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_copywriter_x_creates_three_drafts(monkeypatch: pytest.MonkeyPatch) -> None:
    variants = [
        {"hook_tag": "question-opener", "body": "a https://news.example.com"},
        {"hook_tag": "bold-claim", "body": "b https://news.example.com"},
        {"hook_tag": "behind-the-scenes", "body": "c https://news.example.com"},
    ]
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(return_value=MagicMock(text=json.dumps(variants)))

    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(
        return_value={"id": "b1", "research": {"audience": "x", "findings": {}}, "body": "t"}
    )
    fake_drafts.create_draft = AsyncMock(side_effect=[{"id": f"v{i}"} for i in range(3)])
    fake_analytics = AsyncMock()
    fake_analytics.top_winners_by_platform = AsyncMock(return_value=[])
    fake_analytics.top_hooks_last_n_days = AsyncMock(return_value=[])

    monkeypatch.setattr(cw, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(cw, "_make_drafts_client", lambda: _Ctx(fake_drafts))
    monkeypatch.setattr(cw, "_make_analytics_client", lambda: _Ctx(fake_analytics))

    out = await cw.copywriter_x_node({"brief_id": "b1"})
    assert len(out["drafted_x_ids"]) == 3
    assert fake_drafts.create_draft.await_count == 3
```

- [ ] **Step 2: Implement `copywriter.py`**

```python
from __future__ import annotations
import json
from typing import Literal

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import AnalyticsClient, DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("copywriter")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


def _make_analytics_client() -> AnalyticsClient:
    return AnalyticsClient()


async def _copywriter(state: GraphState, *, platform: Literal["x", "linkedin"]) -> GraphState:
    agent_id = f"copywriter_{platform}"
    agent = load_agent(agent_id)
    brief_id = state["brief_id"]

    async with _make_drafts_client() as drafts:
        brief = await drafts.get_draft(id=brief_id)
        if not brief:
            raise RuntimeError(f"brief not found: {brief_id}")

    async with _make_analytics_client() as analytics:
        winners = await analytics.top_winners_by_platform(platform=platform, days=28, limit=5)
        top_hooks = await analytics.top_hooks_last_n_days(days=28, limit=5)

    user = (
        f"Brief: {json.dumps(brief.get('research') or {})}\n\n"
        f"Voice anchors (top winners on {platform}): {json.dumps(winners)}\n"
        f"Top hooks: {json.dumps(top_hooks)}\n\n"
        "Return a JSON ARRAY of exactly 3 objects, each {hook_tag, body}."
    )
    llm = _make_llm()
    result = await llm.complete(
        tier=ModelTier.SMART, system=agent.system_prompt, user=user, max_tokens=2048
    )
    variants = json.loads(result.text)
    if not isinstance(variants, list) or len(variants) != 3:
        raise ValueError(f"expected 3 variants, got {variants}")

    created: list[str] = []
    async with _make_drafts_client() as drafts:
        for v in variants:
            row = await drafts.create_draft(
                platform=platform,
                parentBriefId=brief_id,
                status="drafted",
                hookTag=v["hook_tag"],
                body=v["body"],
            )
            created.append(row["id"])

    key = "drafted_x_ids" if platform == "x" else "drafted_linkedin_ids"
    return {**state, key: created}


async def copywriter_x_node(state: GraphState) -> GraphState:
    return await _copywriter(state, platform="x")


async def copywriter_linkedin_node(state: GraphState) -> GraphState:
    return await _copywriter(state, platform="linkedin")
```

- [ ] **Step 3: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_copywriter_offline.py -v
git add agents-runtime/src/agents_runtime/nodes/copywriter.py agents-runtime/tests/test_copywriter_offline.py
git commit -m "feat(agents-runtime): copywriter nodes for X + LinkedIn (factory over platform)"
```

---

### Task 10: Editor node

**Files:**
- Modify: `agents-runtime/src/agents_runtime/nodes/editor.py`
- Create: `agents-runtime/tests/test_editor_offline.py`

- [ ] **Step 1: Failing test**

```python
# agents-runtime/tests/test_editor_offline.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents_runtime.nodes import editor as ed
from agents_runtime.state import GraphState


class _Ctx:
    def __init__(self, value):
        self._v = value
    async def __aenter__(self):
        return self._v
    async def __aexit__(self, *a):
        return None


@pytest.mark.asyncio
async def test_editor_approves_clean_drafts(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_llm = AsyncMock()
    fake_llm.complete = AsyncMock(
        return_value=MagicMock(
            text=json.dumps(
                {
                    "verdict": "approve",
                    "scores": {"HARD_VOICE": True},
                    "notes": "looks good",
                    "suggested_edits": None,
                }
            )
        )
    )
    fake_drafts = AsyncMock()
    fake_drafts.get_draft = AsyncMock(return_value={"id": "v1", "platform": "x", "body": "b", "reworkCount": 0})
    fake_drafts.update_draft = AsyncMock()
    fake_drafts.transition_status = AsyncMock(return_value={"id": "v1", "status": "approval_queue"})

    monkeypatch.setattr(ed, "_make_llm", lambda: fake_llm)
    monkeypatch.setattr(ed, "_make_drafts_client", lambda: _Ctx(fake_drafts))

    state: GraphState = {
        "brief_id": "b1",
        "drafted_x_ids": ["v1"],
        "drafted_linkedin_ids": [],
    }
    out = await ed.editor_node(state)
    assert out["editor_verdicts"]["v1"] == "approve"
    # Editor must move drafted → editor_review → approval_queue
    transitions = [c.kwargs["to"] for c in fake_drafts.transition_status.await_args_list]
    assert transitions == ["editor_review", "approval_queue"]
```

- [ ] **Step 2: Implement `editor.py`**

```python
from __future__ import annotations
import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import DraftsClient
from ..prompts import load_agent
from ..state import GraphState

log = structlog.get_logger("editor")


def _make_llm() -> LLM:
    return LLM()


def _make_drafts_client() -> DraftsClient:
    return DraftsClient()


async def editor_node(state: GraphState) -> GraphState:
    agent = load_agent("editor")
    drafts_ids = [*state.get("drafted_x_ids", []), *state.get("drafted_linkedin_ids", [])]
    verdicts: dict[str, str] = {}

    llm = _make_llm()
    async with _make_drafts_client() as drafts:
        for draft_id in drafts_ids:
            draft = await drafts.get_draft(id=draft_id)
            if not draft:
                continue
            await drafts.transition_status(
                draft_id=draft_id, to="editor_review", actor="agent:editor"
            )
            user = (
                f"Draft (platform={draft['platform']}, reworkCount={draft.get('reworkCount', 0)}):\n"
                f"{draft['body']}\n\n"
                "Return JSON per editor_rubric: verdict, scores, notes, suggested_edits."
            )
            result = await llm.complete(
                tier=ModelTier.SMART, system=agent.system_prompt, user=user, max_tokens=512
            )
            try:
                rubric = json.loads(result.text)
            except json.JSONDecodeError:
                log.error("editor non-json", draft_id=draft_id, text=result.text[:200])
                rubric = {"verdict": "editor_reject", "notes": "non-json output"}

            verdict = rubric.get("verdict", "editor_reject")
            verdicts[draft_id] = verdict

            await drafts.update_draft(id=draft_id, editorNotes=rubric)
            if verdict == "approve":
                target = "approval_queue"
            elif verdict == "rework" and draft.get("reworkCount", 0) < 2:
                target = "rework_requested"
            else:
                target = "editor_rejected"
            await drafts.transition_status(
                draft_id=draft_id, to=target, actor="agent:editor", reason=rubric.get("notes", "")
            )

    return {**state, "editor_verdicts": verdicts}
```

- [ ] **Step 3: Run + commit**

```bash
cd agents-runtime && uv run pytest tests/test_editor_offline.py -v
git add agents-runtime/src/agents_runtime/nodes/editor.py agents-runtime/tests/test_editor_offline.py
git commit -m "feat(agents-runtime): editor node — rubric-driven gatekeeper to approval_queue"
```

---

### Task 11: Analyst node + CLI entrypoints

**Files:**
- Modify: `agents-runtime/src/agents_runtime/nodes/analyst.py`
- Create: `agents-runtime/src/agents_runtime/cli.py`

- [ ] **Step 1: Implement `analyst.py`** (heartbeat-driven, not part of the brief DAG)

```python
from __future__ import annotations
import json

import structlog

from ..llm import LLM, ModelTier
from ..mcp_clients import AnalyticsClient, DraftsClient
from ..prompts import load_agent

log = structlog.get_logger("analyst")


async def run_daily_digest() -> None:
    agent = load_agent("analyst")
    llm = LLM()
    async with AnalyticsClient() as analytics:
        winners_x = await analytics.top_winners_by_platform(platform="x", days=1, limit=10)
        winners_li = await analytics.top_winners_by_platform(platform="linkedin", days=1, limit=10)
        user = (
            f"Yesterday's posts:\nX: {json.dumps(winners_x)}\n"
            f"LinkedIn: {json.dumps(winners_li)}\n\n"
            "Write a daily digest as markdown (3-5 bullets)."
        )
        result = await llm.complete(
            tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=1024
        )
        await analytics.write_digest(kind="daily", content_md=result.text)


async def run_weekly_digest() -> None:
    agent = load_agent("analyst")
    llm = LLM()
    async with AnalyticsClient() as analytics:
        hooks = await analytics.top_hooks_last_n_days(days=7, limit=10)
        winners_x = await analytics.top_winners_by_platform(platform="x", days=7, limit=5)
        winners_li = await analytics.top_winners_by_platform(platform="linkedin", days=7, limit=5)
        user = (
            f"Hooks: {json.dumps(hooks)}\nX winners: {json.dumps(winners_x)}\n"
            f"LinkedIn winners: {json.dumps(winners_li)}\n\nWrite a weekly leaderboard digest as markdown."
        )
        result = await llm.complete(
            tier=ModelTier.CHEAP, system=agent.system_prompt, user=user, max_tokens=2048
        )
        await analytics.write_digest(kind="weekly", content_md=result.text)
```

- [ ] **Step 2: Implement `cli.py`**

```python
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
        log.info("done", brief_id=brief["id"], drafted_x=len(final.get("drafted_x_ids", [])),
                 drafted_linkedin=len(final.get("drafted_linkedin_ids", [])))

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
```

- [ ] **Step 3: Commit**

```bash
git add agents-runtime/src/agents_runtime/nodes/analyst.py agents-runtime/src/agents_runtime/cli.py
git commit -m "feat(agents-runtime): analyst digests + CLI (run-week, digest, serve)"
```

---

### Task 12: Long-running agent runner — polls briefed status

**Files:**
- Create: `agents-runtime/src/agents_runtime/agent_runner.py`

> The dispatcher polls `drafts` for rows at `status='briefed'` that have no `research` set, and runs the DAG for each. Concurrency cap: 2 in-flight DAGs.

- [ ] **Step 1: Implement `agent_runner.py`**

```python
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
        SET research = COALESCE(research, '{}'::jsonb) || jsonb_build_object('_runtime_claimed', NOW())
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
                claims = []
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
```

- [ ] **Step 2: Commit**

```bash
git add agents-runtime/src/agents_runtime/agent_runner.py
git commit -m "feat(agents-runtime): long-running agent_runner with claim-on-poll + concurrency cap"
```

---

### Task 13: CI — add Python lane

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  ts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - uses: docker/setup-buildx-action@v3
      - name: Start Postgres
        run: |
          docker compose -f infra/docker-compose.yml up -d
          for i in 1 2 3 4 5 6 7 8 9 10; do
            docker exec paperclip-postgres pg_isready -U paperclip && break || sleep 2
          done
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @paperclip/db migrate
      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm --filter @paperclip/web build

  python:
    runs-on: ubuntu-latest
    needs: ts
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - uses: astral-sh/setup-uv@v3
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - name: Build TS MCPs (Python tests spawn them as subprocesses)
        run: |
          pnpm install --frozen-lockfile
          pnpm --filter './mcp/**' build
      - name: Start Postgres
        run: |
          docker compose -f infra/docker-compose.yml up -d
          sleep 5
          pnpm --filter @paperclip/db migrate
      - name: Python install + test
        working-directory: agents-runtime
        run: |
          uv sync
          uv run pytest -v
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Python lane for agents-runtime (depends on TS lane)"
```

---

### Task 14: Delete Paperclip-specific paths + update README/runbook

**Files:**
- Delete: `paperclip-config/` (entire dir)
- Delete: `scripts/stub-agents/` (entire dir — superseded by `uv run paperclip-agents run-week`)
- Modify: `README.md`
- Modify: `docs/runbook.md`
- Modify: `infra/docker-compose.yml` — add `agent-runner` service

- [ ] **Step 1: Remove deprecated paths**

```bash
git rm -r paperclip-config scripts/stub-agents
```

- [ ] **Step 2: Update `README.md`** — replace the "Paperclip setup" section with:

```markdown
## Agent runtime setup (Python)

After the TS stack is running:

1. `cd agents-runtime && uv sync`
2. Ensure `ANTHROPIC_API_KEY` is in `.env`.
3. Run the full DAG against a manual theme:
   ```bash
   uv run paperclip-agents run-week "Theme: <your theme here>"
   ```
4. Or run the dispatcher continuously (picks up any `briefed` row in Postgres):
   ```bash
   uv run paperclip-agents serve
   ```
5. Daily/weekly digests:
   ```bash
   uv run paperclip-agents digest --kind daily
   uv run paperclip-agents digest --kind weekly
   ```

Agents are defined in `agents/*.yaml` (loaded at runtime — edit and re-run, no restart).
Policies in `policies/*.md` are inlined via `{{policy:NAME}}` markers.
```

Also remove the "Paperclip setup" subsection from README entirely.

- [ ] **Step 3: Update `docs/runbook.md`** — replace "Paperclip dashboard" references with `uv run paperclip-agents` invocations:

Replace:
```markdown
1. Check Paperclip dashboard (`https://agency.example.com:8080`) for which agent is burning.
2. Read recent ticket trail in Paperclip.
```

With:
```markdown
1. Check BetterStack: filter `name:strategist OR name:researcher OR name:copywriter OR name:editor` for token usage spikes.
2. `uv run paperclip-agents` invocations log per-node token counts via structlog.
```

- [ ] **Step 4: Update `infra/docker-compose.yml`** — append:

```yaml
  agent-runner:
    build:
      context: ..
      dockerfile: agents-runtime/Dockerfile
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip
      LOG_FILE_DIR: /var/log/paperclip
    volumes:
      - ../agents:/app/agents:ro
      - ../policies:/app/policies:ro
      - ../mcp:/app/mcp:ro
      - /var/log/paperclip:/var/log/paperclip
    command: ["uv", "run", "paperclip-agents", "serve"]
```

- [ ] **Step 5: Write `agents-runtime/Dockerfile`**

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Install Node for MCP subprocess spawning
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9

WORKDIR /app
COPY agents-runtime/pyproject.toml agents-runtime/uv.lock /app/agents-runtime/
RUN cd /app/agents-runtime && uv sync --frozen --no-dev

COPY . /app
RUN pnpm install --frozen-lockfile --prod=false && pnpm --filter './mcp/**' build

WORKDIR /app/agents-runtime
CMD ["uv", "run", "paperclip-agents", "serve"]
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: drop Paperclip dependency (deleted paperclip-config + stub-agents)

- Python LangGraph runtime now owns agent orchestration
- README + runbook updated to point at uv-run paperclip-agents commands
- docker-compose gains agent-runner service (Python image w/ node for MCP spawning)
"
```

---

### Task 15: End-to-end smoke (real LLMs, real Postgres)

**Files:** none — verification only.

- [ ] **Step 1: Build everything**

```bash
pnpm db:up && pnpm --filter @paperclip/db migrate
pnpm install && pnpm --filter './mcp/**' build
cd agents-runtime && uv sync
```

- [ ] **Step 2: Set `ANTHROPIC_API_KEY` in `.env`**

- [ ] **Step 3: Run the full DAG once**

```bash
cd agents-runtime
uv run paperclip-agents run-week "Theme: building an AI marketing agency without Paperclip"
```
Expected: ~5-10 min later, 6 drafts in `/queue` (3 X + 3 LinkedIn), all `approval_queue`.

- [ ] **Step 4: Visit the dashboard**

```bash
pnpm --filter @paperclip/web dev
# http://localhost:3000/queue — see 6 drafts with rubric-flavored editor notes
```

- [ ] **Step 5: Optional — run dispatcher long-form**

```bash
uv run paperclip-agents serve &
# In another terminal, create another brief manually:
docker exec paperclip-postgres psql -U paperclip -d paperclip \
  -c "INSERT INTO drafts(platform, status, body) VALUES ('x', 'briefed', 'Theme: contrarian take')"
# Within 30s, dispatcher claims and runs DAG.
```

- [ ] **Step 6: No commit; verification only**

---

### Self-Review

**Spec coverage:**
- Python package + uv + LangGraph — Tasks 1-2, 6. ✓
- YAML+policy prompt loader — Task 2. ✓
- LLM client with prompt caching — Task 3. ✓
- MCP stdio clients for all 5 servers — Tasks 4-5. ✓
- 5 agent nodes (strategist, researcher, copywriter×2, editor) + analyst digest functions — Tasks 7-11. ✓
- Long-running dispatcher — Task 12. ✓
- CI: Python lane behind TS lane — Task 13. ✓
- Deletion of Paperclip artifacts — Task 14. ✓
- End-to-end smoke — Task 15. ✓

**Placeholder scan:** none. Each task contains full implementations.

**Type consistency:** `DraftsClient`, `XClient`, `LinkedInClient`, `ResearchClient`, `AnalyticsClient` are async context managers. `LLM.complete` takes `tier`, `system`, `user`; nodes use it uniformly. `GraphState` keys (`brief_id`, `theme`, `research_done`, `drafted_x_ids`, `drafted_linkedin_ids`, `editor_verdicts`) consistent across all nodes.

**Identified gap:** `chief_of_staff.yaml` is loaded by no node. That's intentional in this plan — the COS role becomes a *cron entry* in the dispatcher (Plan 4 spec described COS as weekly heartbeat). For v1 of the LangGraph runtime, the DAG starts at the Strategist on a per-brief basis; the COS planning role is replaced by either (a) the human running `run-week "<theme>"` or (b) a future weekly cron in `agent_runner.py`. README should call this out.

**Test count after Plan 7:** ~7-9 new Python tests (prompts, llm, mcp_drafts integration, graph_shape, strategist, researcher, copywriter, editor). All TS tests remain — total ~78-80 across both languages.

---

### What you have after Plan 7

A fully Paperclip-free agency. `uv run paperclip-agents run-week "<theme>"` runs the real LangGraph DAG with real LLMs against real MCP servers in ~5-10 minutes, dropping 6 drafts into the existing Next.js queue. The dispatcher `serve` mode picks up new briefs from any source (web UI, manual SQL insert, cron). The TS web shell, workers, MCPs, and schema are unchanged. ~15 commits, ~1500 LoC (Python).
