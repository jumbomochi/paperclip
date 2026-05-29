# Paperclip — Zero-Human Marketing Agency

An open-source AI marketing agency. Drafts → editor → human approval queue → automatic X posting + manual LinkedIn paste → UTM-attributed signups → analytics feedback loop.

Agents orchestrated by a Python LangGraph DAG; everything else (web UI, MCP servers, workers, schema) is TypeScript.

## Local setup

1. `pnpm install`
2. `pnpm db:up && pnpm db:migrate`
3. Generate a 32-byte token-encryption key:
   ```bash
   node -e 'console.log("base64:"+require("crypto").randomBytes(32).toString("base64"))'
   ```
   Paste into `.env` as `TOKEN_ENC_KEY=...`. Also add `ANTHROPIC_API_KEY=sk-ant-…`.
4. Get X Basic-tier API keys (OAuth 1.0a user context). Export `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`. Then `pnpm seed:x-creds`.
5. Build the TS bits the Python agent runtime needs:
   ```bash
   pnpm --filter @paperclip/db build
   pnpm --filter @paperclip/shared build
   pnpm --filter './mcp/**' build
   ```
6. Start the dashboard: `pnpm --filter @paperclip/web dev` — http://localhost:3000/queue
7. Approve in the UI — scheduler posts X drafts on its 15-min tick. LinkedIn drafts surface in awaiting_paste; copy + paste, then paste URL back.

## Agent runtime (Python LangGraph)

```bash
cd agents-runtime && uv sync
```

Run the full DAG end-to-end against a manual theme:

```bash
uv run paperclip-agents run-week "Theme: <your theme here>"
```

Or run the long-running dispatcher (polls Postgres for `briefed` rows):

```bash
uv run paperclip-agents serve
```

Daily / weekly Analyst digests:

```bash
uv run paperclip-agents digest --kind daily
uv run paperclip-agents digest --kind weekly
```

Agents are defined in `agents/*.yaml` (loaded at runtime — edit and re-run, no restart). Policies in `policies/*.md` are inlined via `{{policy:NAME}}` markers.

The Chief-of-Staff role is fulfilled by `run-week` invocations (human or weekly cron) — there's no COS LangGraph node.

## Newsletter (Beehiiv) setup

1. Beehiiv → Settings → Integrations → Webhooks: add `https://<host>/webhook/newsletter` with event `subscription.created`.
2. Set `ATTRIBUTION_WEBHOOK_SECRET` env var on attribution-mcp; configure Beehiiv to send it as `Authorization: Bearer <secret>`.
3. Optional: `BEEHIIV_API_KEY` + `BEEHIIV_PUBLICATION_ID` for the daily reconciliation cron.

If you use a different newsletter platform: implement the `NewsletterClient` interface (`mcp/attribution-mcp/src/newsletterClients/types.ts`).

## Project structure

- `apps/web/` — Next.js dashboard (approval queue, post detail, leaderboards, digests).
- `db/` — Drizzle schema + migrations; one Postgres for everything.
- `mcp/` — One MCP server per concern (drafts, x, linkedin, research, attribution, analytics).
- `workers/` — TS background processes (scheduler, metrics-collector, notifier, cost-watchdog).
- `agents-runtime/` — Python LangGraph agent layer (uv + Python 3.13).
- `agents/`, `policies/` — Loaded at runtime by `agents-runtime`.
- `evals/` — promptfoo golden-set evals for agents (CI-gated).
- `infra/` — docker-compose, Caddyfile, vector config, backup script.
- `docs/superpowers/` — design specs + implementation plans.

## Tests

```bash
pnpm test       # all TS tests
pnpm typecheck  # all TS typecheck
cd agents-runtime && uv run pytest -v
```

## See also

- [Design spec](docs/superpowers/specs/2026-05-26-zero-human-marketing-agency-design.md)
- Implementation plans 1-7 under `docs/superpowers/plans/`
- [Runbook](docs/runbook.md) — incident playbook
