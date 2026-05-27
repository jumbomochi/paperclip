# Paperclip — Zero-Human Marketing Agency

An open-source AI marketing agency built on [Paperclip](https://paperclip.ing/). Drafts → editor → human approval queue → automatic X posting + manual LinkedIn paste → UTM-attributed signups → analytics feedback loop.

## Local setup

1. `pnpm install`
2. `pnpm db:up && pnpm db:migrate`
3. Generate a 32-byte token-encryption key:
   ```bash
   node -e 'console.log("base64:"+require("crypto").randomBytes(32).toString("base64"))'
   ```
   Paste into `.env` as `TOKEN_ENC_KEY=...`.
4. Get X Basic-tier API keys (OAuth 1.0a user context). Export `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`. Then `pnpm seed:x-creds`.
5. `pnpm --filter @paperclip/stub-agents stub:run-week` — exercises the full pipeline without LLMs (Plan 2/3 verification).
6. `pnpm --filter @paperclip/web dev` — http://localhost:3000/queue
7. Approve in the UI — scheduler posts X drafts on its 15-min tick. LinkedIn drafts surface in awaiting_paste; copy + paste, then paste URL back.

## Newsletter (Beehiiv) setup

1. Beehiiv → Settings → Integrations → Webhooks: add `https://<host>/webhook/newsletter` with event `subscription.created`.
2. Set `ATTRIBUTION_WEBHOOK_SECRET` env var on attribution-mcp; configure Beehiiv to send it as `Authorization: Bearer <secret>`.
3. Optional: `BEEHIIV_API_KEY` + `BEEHIIV_PUBLICATION_ID` for the daily reconciliation cron.

If you use a different newsletter platform: implement the `NewsletterClient` interface (`mcp/attribution-mcp/src/newsletterClients/types.ts`).

## Paperclip setup

After [Paperclip](https://paperclip.ing/) is installed (vendor it as a submodule or follow upstream docs):

1. Point Paperclip at `paperclip-config/paperclip.yaml` (adapt keys to Paperclip's actual schema).
2. Mount `agents/`, `policies/`, and built `mcp/*/dist/` directories.
3. `pnpm brief "<theme>"` to kick off a manual run.

## Project structure

- `apps/web/` — Next.js dashboard (approval queue, post detail, leaderboards, digests).
- `db/` — Drizzle schema + migrations; one Postgres for everything.
- `mcp/` — One MCP server per concern (drafts, x, linkedin, research, attribution, analytics).
- `workers/` — Background processes (scheduler, metrics-collector, notifier, cost-watchdog).
- `agents/`, `policies/` — Paperclip-loaded YAML/markdown.
- `evals/` — promptfoo golden-set evals for agents (CI-gated).
- `infra/` — docker-compose, Caddyfile, vector config, backup script.
- `docs/superpowers/` — design specs + implementation plans.

## Tests

```bash
pnpm test       # all package tests
pnpm typecheck  # all package typecheck
```

## See also

- [Design spec](docs/superpowers/specs/2026-05-26-zero-human-marketing-agency-design.md)
- Implementation plans 1-6 under `docs/superpowers/plans/`
- [Runbook](docs/runbook.md) — incident playbook
