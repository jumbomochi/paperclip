# Runbook

## "/api/health is down"
1. SSH in. `sudo systemctl status paperclip`.
2. `cd /opt/paperclip && docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps`
3. Whichever service is unhealthy: `docker compose ... logs <service> --tail=200`.
4. Postgres unhealthy? Check disk: `df -h`. If full, see backup retention.

## "Cost watchdog warned"
1. Check BetterStack: filter `name:strategist OR name:researcher OR name:copywriter OR name:editor` for token-usage spikes.
2. `agents-runtime` logs per-node `input_tokens` / `cache_read_tokens` via structlog.
3. Tighten the relevant agent's prompt in `agents/*.yaml` (shorter context = fewer tokens). Restart the runner.
4. If acute, pause the runner: `docker compose stop agent-runner`. Investigate.

## "I need to restore from backup"
```sh
cd /opt/paperclip
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml exec backup /restore.sh
```
Restart workers: `docker compose ... restart scheduler metrics-collector attribution-mcp notifier agent-runner`.

## "X account suspended"
1. Do not auto-recover — investigate first.
2. `docker compose stop scheduler` to halt posting.
3. Read X's email. Common causes: too-similar-content, automation flag.
4. Tighten cadence cap, increase jitter, reduce thread length. Redeploy.
5. Wait at least 48h before re-enabling.

## "LinkedIn drafts piling up"
Notifier should ping at 60min stale. If it isn't:
- Confirm `notifier` is running.
- Check `WEB_BASE_URL` env var.
- Check email transport: `docker compose logs notifier --tail=50`.

## "Prompt regression in CI"
1. Look at the failing case's diff in promptfoo output.
2. Re-run locally: `pnpm evals --config evals/<agent>/promptfooconfig.yaml`.
3. Either: revert the prompt change, or adjust the failing case if it's outdated.

## Routine: weekly rituals (15 min total)
- Monday: review the new week's briefs.
- Wednesday: empty the queue.
- Friday: read the weekly digest.
- Once/month: rotate `TOKEN_ENC_KEY` via `scripts/rotate-token.ts`.

## Monitoring
- BetterStack heartbeat (15-min): if scheduler tick fails silently, pages within 30 min.
- UptimeRobot synthetic (5-min): /api/health; if web or Postgres is down, page within 10 min.
- BetterStack logs: filter by `level=error`.
