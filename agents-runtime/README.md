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

# Analyst digests:
uv run paperclip-agents digest --kind daily
uv run paperclip-agents digest --kind weekly
```

## Architecture

State machine in Postgres (`drafts.status`) drives the dispatcher. For each brief, a LangGraph DAG runs:

```
START → strategist → researcher → [copywriter_x, copywriter_linkedin] → editor → END
```

Each node spawns MCP stdio subprocesses pointed at the existing TS servers under `mcp/*/dist/server.js`.
Run `pnpm -r build` once before starting Python tests that hit MCP servers.

Chief-of-Staff role is fulfilled by `run-week` invocations (human or weekly cron).
