# TODO / Handoff

Repo state as of last commit. Authored as a handoff between Claude sessions.

## Where things stand

7 plans completed and committed on `main`:

1. Foundation (db + drafts-mcp + web shell)
2. X integration + stub agents (stubs since removed in Plan 7)
3. LinkedIn manual-paste + attribution
4. Real Paperclip agents (**superseded by Plan 7**)
5. Evals + analyst loop
6. Production hardening (Caddy, B2 backups, vector, cost-watchdog)
7. LangGraph hybrid migration (Python agent runtime replacing Paperclip)

CI green (TS + Python lanes). Repo: https://github.com/jumbomochi/paperclip.

```
74 TS tests across 11 packages + 12 Python tests (11 offline + 1 MCP integration)
```

## High-priority operator actions (the unfinished real work)

These need credentials/accounts I can't create — has to be a human (or the next Claude with creds in env).

- [ ] **Run the agent runtime end-to-end against real LLMs.** Set `ANTHROPIC_API_KEY` in `.env`, then:
  ```bash
  pnpm db:up && pnpm db:migrate
  pnpm --filter @paperclip/db build
  pnpm --filter @paperclip/shared build
  pnpm --filter './mcp/**' build
  cd agents-runtime && uv sync
  uv run paperclip-agents run-week "Theme: <real theme>"
  ```
  Then `pnpm --filter @paperclip/web dev` and visit http://localhost:3000/queue to confirm 6 drafts (3 X + 3 LinkedIn) appear with editor verdicts attached. **This has never been run with real LLMs yet.**

- [ ] **Wire X creds** ($200/mo Basic tier). Export `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`. Run `pnpm seed:x-creds`. Build + start scheduler: `node workers/scheduler/dist/index.js`.

- [ ] **Pick a newsletter platform** and wire its webhook. Beehiiv client is written (`mcp/attribution-mcp/src/newsletterClients/beehiiv.ts`); for anything else, implement `NewsletterClient` interface in the same dir. Configure `ATTRIBUTION_WEBHOOK_SECRET` + optionally `BEEHIIV_API_KEY` + `BEEHIIV_PUBLICATION_ID`.

- [ ] **Production deployment.** Plan 6's `infra/deploy/bootstrap.sh` is idempotent and ready. Needs:
  - VPS (Hetzner CX22 = 4GB/2vCPU recommended)
  - DNS A record → VPS IP
  - All `.env` values populated per `infra/deploy/README.md` (look for the "Required secrets" list)
  - Backblaze B2 bucket + keys for nightly Postgres backup
  - BetterStack account for log aggregation + heartbeat
  - UptimeRobot synthetic monitor on `/api/health`

- [ ] **Eval cases.** Plan 5 wrote the promptfoo harness with **1 starter case per agent** (`evals/copywriter_x/cases/001-launch-announce.yaml`, etc.). The plan calls for ~55 cases total (20 copywriter-x + 15 copywriter-linkedin + 20 editor). Without these, the CI eval gate at 95% is meaningless. Author them in chunks of ~5/session.

## Open code work (clean lifts)

- [ ] **`chief_of_staff.yaml` is unused.** Plan 7 self-review flagged this — the COS role became "human runs `paperclip-agents run-week`". Either delete the YAML or wire it as a weekly cron in `agents-runtime/src/agents_runtime/agent_runner.py`.

- [ ] **`/leaderboards` page uses raw SQL** (`apps/web/app/leaderboards/page.tsx`). Could be refactored to call `analytics-mcp.topHooksLastNDays` instead — single source of truth for the aggregation logic. Same query lives twice right now.

- [ ] **No auth on `/queue`.** In single-operator local mode this is fine; for the production VPS, add basic auth via Caddy or a Next.js middleware. The runbook assumes the operator's the only one with the URL.

- [ ] **Web build is slow on each Next.js iteration.** Could add Turbopack (`next dev --turbo`) — not blocking.

- [ ] **`workers/cost-watchdog`** is observe-only. Plan 6 spec mentioned circuit-breaker behavior (flip a `paused` flag the agent runtime respects). Currently it just sends webhook notifications.

- [ ] **`workers/notifier`** transport defaults to console. Operator needs `NOTIFIER_TRANSPORT=email` + `SMTP_*` to actually get pinged about stale LinkedIn drafts.

## Known gotchas (read these before reopening)

- **`pnpm install` won't auto-build** `@paperclip/db` and `@paperclip/shared`. Both point `main` → `dist/index.js`. If anything that imports them fails with "Failed to resolve entry for package", run:
  ```bash
  pnpm --filter @paperclip/db build
  pnpm --filter @paperclip/shared build
  pnpm --filter './mcp/**' build
  ```
  CI does this automatically in `.github/workflows/ci.yml`; locally, do it once after fresh clone or after dependency changes.

- **`pnpm/action-setup@v4` rejects explicit `version` when `package.json#packageManager` is set.** Both must agree — currently we don't set `with: version` in any workflow. If you re-add it, drop the `packageManager` field too.

- **`pnpm -r test` needs `--workspace-concurrency=1`** because multiple packages share the same Postgres and clean `drafts` in `beforeEach`. Cross-package parallelism causes FK constraint violations. CI already does this.

- **MCP servers spawn the TS dist** via stdio from Python. After any change to `mcp/*/src` or `db/src` or `packages/shared/src`, rebuild before re-running Python tests:
  ```bash
  pnpm --filter './mcp/**' build && pnpm --filter @paperclip/db build && pnpm --filter @paperclip/shared build
  ```

- **Hatch editable install layout (Python).** `agents-runtime/pyproject.toml` needs both `[tool.hatch.build.targets.wheel.sources]` *and* `[tool.hatch.build.targets.editable.sources]` mapping `"src/agents_runtime" = "agents_runtime"`. Without the editable mapping, `uv sync` succeeds but pytest can't find the package.

- **Postgres dev port is `5434`, not `5433`.** Local machine had another `paperclip-postgres` from an unrelated repo on 5433. All connection strings and `.env.example` reflect this.

- **`mcp/*/tsconfig.json` excludes `tests/`** so `tsc` emits `dist/server.js` (not `dist/src/server.js`). The `"bin"` entries in each MCP `package.json` depend on this. Don't re-add tests/ to `include`.

- **Plan 4 is stale.** It described real Paperclip agents and a vendored submodule. Plan 7 supersedes it. The YAML agent definitions stayed (they're loaded by the LangGraph runtime), but `paperclip-config/` and Paperclip-the-product are gone.

## Quick-reference paths

- Specs + plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`
- Runbook: `docs/runbook.md`
- Deployment: `infra/deploy/README.md`
- Agent prompts: `agents/*.yaml`
- Policies: `policies/*.md`
- Web pages: `apps/web/app/{queue,posts,leaderboards,digests}/`
- Python runtime: `agents-runtime/src/agents_runtime/`

## What I'd do first

If I were picking this up fresh tomorrow with `ANTHROPIC_API_KEY` already in `.env`:

1. `pnpm db:up && pnpm db:migrate && pnpm --filter @paperclip/db build && pnpm --filter @paperclip/shared build && pnpm --filter './mcp/**' build` — get the build state right.
2. `cd agents-runtime && uv sync && uv run paperclip-agents run-week "Theme: <something honest you'd actually post>"` — first real end-to-end. ~$0.10-0.30 of API spend, ~5-10 min.
3. `pnpm --filter @paperclip/web dev` — read the 6 drafts the agency produced. Check the editor's rubric output. This is the moment of truth for the project — does it produce content you'd ship?
4. From there: depending on output quality, either tighten `agents/*.yaml` prompts and re-run, or invest in eval cases (Plan 5 unfinished work) before scaling up.
