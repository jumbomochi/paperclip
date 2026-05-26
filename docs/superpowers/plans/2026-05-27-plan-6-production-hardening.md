# Plan 6 — Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the dev-stack agency live on a single VPS with HTTPS, encrypted secrets, daily off-site Postgres backups, structured logs flowing to a managed aggregator, uptime monitoring, and a cost-watchdog that alerts when monthly LLM spend trends past your caps. After this ships, you can leave it running unattended for a week and trust that (a) it's still up, (b) you'd find out fast if it weren't, (c) you can restore from yesterday's backup in < 15 minutes.

**Architecture:** Single VPS (Hetzner CX22 or DigitalOcean Premium Intel 4GB) running Docker Compose with restart policies. Caddy as TLS terminator + reverse proxy. Postgres backups via `pg_dump` cron pushing to Backblaze B2 (or S3) with 14-day retention. Logs ship via `pino-pretty` → file → `vector` → BetterStack (or Axiom). Uptime: BetterStack heartbeat + UptimeRobot synthetic. Cost: a small `cost-watchdog` worker queries Anthropic's usage API daily.

**Tech Stack:** Plans 1-5 stack, plus Caddy, vector, BetterStack (or alternative log aggregator), Backblaze B2 (or S3), `node-cron`, Anthropic Admin API.

**Depends on:** Plans 1-5 complete.

---

## File Structure

```
paperclip/
├── infra/
│   ├── docker-compose.yml                    # +caddy, +vector, +cost-watchdog
│   ├── docker-compose.prod.yml               # NEW: overrides (restart policies, no profiles)
│   ├── Caddyfile                             # NEW
│   ├── vector.toml                           # NEW
│   ├── backup/
│   │   ├── Dockerfile                        # NEW
│   │   ├── backup.sh                         # NEW
│   │   └── restore.sh                        # NEW
│   └── deploy/
│       ├── README.md                         # NEW: VPS bootstrap + day-2 runbook
│       ├── bootstrap.sh                      # NEW: idempotent host setup
│       └── systemd/
│           └── paperclip.service             # NEW
├── workers/
│   └── cost-watchdog/                        # NEW
│       ├── package.json                      # @paperclip/cost-watchdog
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   └── fetchAnthropicUsage.ts
│       └── tests/fetchAnthropicUsage.test.ts
├── scripts/
│   ├── rotate-token.ts                       # NEW: re-encrypt with a new TOKEN_ENC_KEY
│   └── healthcheck.sh                        # NEW
└── docs/
    └── runbook.md                            # NEW: incident playbook
```

---

### Task 1: docker-compose.prod.yml — restart policies + remove `profiles`

**Files:**
- Create: `infra/docker-compose.prod.yml`

- [ ] **Step 1: Write `infra/docker-compose.prod.yml`**

```yaml
# Production override. Use as:
#   docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d
services:
  postgres:
    restart: unless-stopped
    profiles: []                                  # always on
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD?required}

  scheduler:           { restart: unless-stopped, profiles: [] }
  metrics-collector:   { restart: unless-stopped, profiles: [] }
  attribution-mcp:     { restart: unless-stopped, profiles: [] }
  research-mcp:        { restart: unless-stopped, profiles: [] }
  analytics-mcp:       { restart: unless-stopped, profiles: [] }
  notifier:            { restart: unless-stopped, profiles: [] }
  paperclip:           { restart: unless-stopped, profiles: [] }

  web:
    image: ${IMAGE_REGISTRY:-ghcr.io/jdoh}/paperclip-web:${IMAGE_TAG:-latest}
    restart: unless-stopped
    profiles: []
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:${POSTGRES_PASSWORD}@postgres:5432/paperclip
      NODE_ENV: production
    ports:
      - "127.0.0.1:3000:3000"        # caddy reverse-proxies from :80/:443

  caddy:
    image: caddy:2.8-alpine
    restart: unless-stopped
    profiles: []
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web, attribution-mcp]

  vector:
    image: timberio/vector:0.42.0-alpine
    restart: unless-stopped
    profiles: []
    volumes:
      - ./vector.toml:/etc/vector/vector.toml:ro
      - /var/log/paperclip:/var/log/paperclip:ro
    environment:
      LOGS_TOKEN: ${LOGS_TOKEN?required}

  backup:
    build:
      context: backup
    restart: unless-stopped
    profiles: []
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      PGHOST: postgres
      PGUSER: paperclip
      PGPASSWORD: ${POSTGRES_PASSWORD?required}
      PGDATABASE: paperclip
      B2_KEY_ID: ${B2_KEY_ID?required}
      B2_APPLICATION_KEY: ${B2_APPLICATION_KEY?required}
      B2_BUCKET: ${B2_BUCKET?required}

  cost-watchdog:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: cost-watchdog, KIND: worker }
    restart: unless-stopped
    profiles: []
    env_file: ../.env
    environment:
      ANTHROPIC_ADMIN_KEY: ${ANTHROPIC_ADMIN_KEY?required}

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 2: Commit**

```bash
git add infra/docker-compose.prod.yml
git commit -m "feat(infra): production override file with restart policies + caddy/vector/backup/watchdog"
```

---

### Task 2: Caddy reverse proxy with HTTPS

**Files:**
- Create: `infra/Caddyfile`

- [ ] **Step 1: Write `infra/Caddyfile`** *(replace `agency.example.com` with your real domain)*

```
{
  email letsencrypt@example.com
  servers {
    trusted_proxies static private_ranges
  }
}

agency.example.com {
  encode zstd gzip
  log {
    output file /var/log/paperclip/caddy.log
    format json
  }

  # Web UI
  reverse_proxy /api/* web:3000
  reverse_proxy /queue* web:3000
  reverse_proxy /posts/* web:3000
  reverse_proxy /digests* web:3000
  reverse_proxy /leaderboards* web:3000
  reverse_proxy / web:3000

  # Attribution webhook (separate path so beehiiv can reach it directly)
  reverse_proxy /webhook/* attribution-mcp:4001
  reverse_proxy /health attribution-mcp:4001

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
```

- [ ] **Step 2: Verify Caddyfile syntax locally** (requires Caddy installed; optional)

```bash
docker run --rm -v $(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile caddy:2.8-alpine caddy validate --config /etc/caddy/Caddyfile
```
Expected: `Valid configuration`.

- [ ] **Step 3: Commit**

```bash
git add infra/Caddyfile
git commit -m "feat(infra): Caddyfile for TLS + reverse-proxy to web and attribution-mcp"
```

---

### Task 3: Postgres backups to Backblaze B2 (or S3)

**Files:**
- Create: `infra/backup/Dockerfile`
- Create: `infra/backup/backup.sh`
- Create: `infra/backup/restore.sh`

- [ ] **Step 1: `infra/backup/Dockerfile`**

```dockerfile
FROM postgres:16-alpine
RUN apk add --no-cache curl gzip py3-pip ca-certificates && \
    pip install --no-cache-dir --break-system-packages b2
COPY backup.sh /backup.sh
COPY restore.sh /restore.sh
RUN chmod +x /backup.sh /restore.sh
ENV BACKUP_CRON="0 5 * * *"
CMD ["sh", "-c", "echo \"$BACKUP_CRON /backup.sh\" > /etc/crontabs/root && crond -f -l 2"]
```

- [ ] **Step 2: `infra/backup/backup.sh`**

```sh
#!/bin/sh
set -eu

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="/tmp/paperclip-$ts.sql.gz"

echo "[backup $ts] dumping..."
pg_dump --no-owner --no-acl "$PGDATABASE" | gzip -9 > "$file"

bytes="$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")"
echo "[backup $ts] dump size: $bytes bytes"
if [ "$bytes" -lt 1024 ]; then
  echo "[backup $ts] dump suspiciously small; aborting upload"
  exit 1
fi

echo "[backup $ts] authenticating to B2..."
b2 account authorize "$B2_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null

remote="$B2_BUCKET/paperclip/$(date -u +%Y/%m)/paperclip-$ts.sql.gz"
echo "[backup $ts] uploading to b2://$remote ..."
b2 file upload "$B2_BUCKET" "$file" "paperclip/$(date -u +%Y/%m)/paperclip-$ts.sql.gz" >/dev/null

echo "[backup $ts] pruning > 14 days..."
b2 ls --recursive --json "$B2_BUCKET" "paperclip/" | \
  python3 -c '
import json, sys, datetime
cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=14)
for line in sys.stdin:
    line=line.strip()
    if not line or line == "[" or line == "]" or line.endswith(","): continue
    try:
        f = json.loads(line.rstrip(","))
    except: continue
    ts = datetime.datetime.utcfromtimestamp(f["uploadTimestamp"]/1000)
    if ts < cutoff:
        print(f["fileName"])
' | while read -r name; do
  if [ -n "$name" ]; then
    b2 file delete "$B2_BUCKET/$name" >/dev/null || true
    echo "  pruned: $name"
  fi
done

rm -f "$file"
echo "[backup $ts] done"
```

- [ ] **Step 3: `infra/backup/restore.sh`**

```sh
#!/bin/sh
# Restore the latest backup from B2 into the local Postgres.
# WARNING: drops + recreates the target database.
set -eu

if [ -z "${B2_BUCKET-}" ] || [ -z "${PGDATABASE-}" ]; then
  echo "B2_BUCKET and PGDATABASE required"; exit 1
fi

b2 account authorize "$B2_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null
latest="$(b2 ls --recursive --json "$B2_BUCKET" "paperclip/" | \
  python3 -c '
import json, sys
files=[]
for line in sys.stdin:
    line=line.strip()
    if not line or line in ("[","]") or line.endswith(","): continue
    try: f=json.loads(line.rstrip(","))
    except: continue
    files.append(f)
files.sort(key=lambda f: f["uploadTimestamp"])
print(files[-1]["fileName"] if files else "")')"

if [ -z "$latest" ]; then
  echo "no backups found"; exit 1
fi

echo "Latest: $latest"
echo "About to drop+recreate $PGDATABASE on $PGHOST. Press Ctrl-C to abort."
sleep 5

b2 file download "$B2_BUCKET/$latest" /tmp/restore.sql.gz
gunzip -f /tmp/restore.sql.gz
psql -h "$PGHOST" -U "$PGUSER" -d postgres <<SQL
DROP DATABASE IF EXISTS "$PGDATABASE";
CREATE DATABASE "$PGDATABASE";
SQL
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f /tmp/restore.sql
rm -f /tmp/restore.sql
echo "Restore complete"
```

- [ ] **Step 4: Build backup image**

```bash
docker build -t paperclip-backup infra/backup
```
Expected: clean build.

- [ ] **Step 5: Dry-run backup against local Postgres**

```bash
docker run --rm \
  -e PGHOST=host.docker.internal -e PGUSER=paperclip -e PGPASSWORD=paperclip_dev -e PGDATABASE=paperclip \
  -e B2_KEY_ID=$B2_KEY_ID -e B2_APPLICATION_KEY=$B2_APPLICATION_KEY -e B2_BUCKET=$B2_BUCKET \
  paperclip-backup /backup.sh
```
Expected: dump uploaded; size logged; prune log (probably nothing to prune on day one).

- [ ] **Step 6: Commit**

```bash
git add infra/backup/
git commit -m "feat(backup): nightly pg_dump → B2 with 14-day retention"
```

---

### Task 4: Vector log shipping config

**Files:**
- Create: `infra/vector.toml`

- [ ] **Step 1: `infra/vector.toml`** *(target BetterStack as an example; swap for Axiom/Loki/etc.)*

```toml
[sources.paperclip_logs]
type = "file"
include = ["/var/log/paperclip/*.log"]
read_from = "end"

[transforms.parse_pino]
type = "remap"
inputs = ["paperclip_logs"]
source = '''
parsed, err = parse_json(.message)
if err == null {
  . = merge(., parsed)
}
'''

[sinks.betterstack]
type = "http"
inputs = ["parse_pino"]
uri = "https://in.logs.betterstack.com/"
encoding.codec = "json"
auth.strategy = "bearer"
auth.token = "${LOGS_TOKEN}"
batch.max_events = 100
```

- [ ] **Step 2: Update each worker to write to `/var/log/paperclip/<name>.log`**

In each worker's `src/index.ts` (`scheduler`, `metrics-collector`, `notifier`, `cost-watchdog`), update the logger init:

```ts
import pino from 'pino';
import { mkdirSync } from 'node:fs';
mkdirSync('/var/log/paperclip', { recursive: true });
const log = pino({ name: 'scheduler' /* or appropriate */ }, pino.destination('/var/log/paperclip/scheduler.log'));
```

For dev, fall back to stdout when `/var/log/paperclip` isn't writable — wrap the `pino.destination` call in a try/catch or condition on `process.env.NODE_ENV === 'production'`.

Better: extend `packages/shared/src/logger.ts` to handle this once:

```ts
import pino from 'pino';
import { existsSync, mkdirSync } from 'node:fs';

export function makeLogger(name: string) {
  if (process.env.LOG_FILE_DIR) {
    try {
      mkdirSync(process.env.LOG_FILE_DIR, { recursive: true });
      return pino(
        { name, level: process.env.LOG_LEVEL ?? 'info' },
        pino.destination({ dest: `${process.env.LOG_FILE_DIR}/${name}.log`, sync: false }),
      );
    } catch { /* fall through to stdout */ }
  }
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.LOG_PRETTY === '1' ? { target: 'pino-pretty' } : undefined,
  });
}
```

Set `LOG_FILE_DIR=/var/log/paperclip` in production environment.

- [ ] **Step 3: Commit**

```bash
git add infra/vector.toml packages/shared/src/logger.ts
git commit -m "feat(infra): vector + file-based pino logging routed to BetterStack"
```

---

### Task 5: `cost-watchdog` worker (TDD)

**Files:**
- Create: `workers/cost-watchdog/package.json`
- Create: `workers/cost-watchdog/tsconfig.json`
- Create: `workers/cost-watchdog/src/fetchAnthropicUsage.ts`
- Create: `workers/cost-watchdog/src/index.ts`
- Create: `workers/cost-watchdog/tests/fetchAnthropicUsage.test.ts`

- [ ] **Step 1: `workers/cost-watchdog/package.json`**

```json
{
  "name": "@paperclip/cost-watchdog",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "bin": { "cost-watchdog": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@paperclip/shared": "workspace:*",
    "node-cron": "3.0.3"
  },
  "devDependencies": {
    "@types/node-cron": "3.0.11",
    "msw": "2.4.9",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `workers/cost-watchdog/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "tests/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Failing test `workers/cost-watchdog/tests/fetchAnthropicUsage.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchAnthropicUsage } from '../src/fetchAnthropicUsage.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchAnthropicUsage', () => {
  it('returns total spend USD for the month', async () => {
    server.use(
      http.get('https://api.anthropic.com/v1/organizations/usage_report/messages', () =>
        HttpResponse.json({
          data: [{ amount_usd: 12.34 }, { amount_usd: 5.66 }],
        }),
      ),
    );
    const r = await fetchAnthropicUsage({ adminKey: 'k', month: '2026-05' });
    expect(r.usdSpent).toBe(18);
  });

  it('returns 0 when no data', async () => {
    server.use(
      http.get('https://api.anthropic.com/v1/organizations/usage_report/messages', () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const r = await fetchAnthropicUsage({ adminKey: 'k', month: '2026-05' });
    expect(r.usdSpent).toBe(0);
  });
});
```

- [ ] **Step 4: Implement `workers/cost-watchdog/src/fetchAnthropicUsage.ts`**

```ts
export async function fetchAnthropicUsage(input: { adminKey: string; month: string }): Promise<{ usdSpent: number }> {
  const url = `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${input.month}-01&ending_at=${nextMonth(input.month)}-01`;
  const r = await fetch(url, {
    headers: {
      'x-api-key': input.adminKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!r.ok) throw new Error(`anthropic usage ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data: Array<{ amount_usd?: number }> };
  const usdSpent = body.data.reduce((sum, d) => sum + (d.amount_usd ?? 0), 0);
  return { usdSpent };
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 5: Implement `workers/cost-watchdog/src/index.ts`**

```ts
import cron from 'node-cron';
import { makeLogger } from '@paperclip/shared';
import { fetchAnthropicUsage } from './fetchAnthropicUsage.js';

const log = makeLogger('cost-watchdog');

const CAP_USD = Number(process.env.MONTHLY_LLM_CAP_USD ?? 180);
const WARN_PCT = 0.7;
const STOP_PCT = 1.0;
const KEY = process.env.ANTHROPIC_ADMIN_KEY!;
const NOTIFY_URL = process.env.WATCHDOG_NOTIFY_URL; // e.g. discord/slack webhook

async function notify(level: 'info' | 'warn' | 'critical', message: string) {
  log.info({ level, message }, 'notification');
  if (!NOTIFY_URL) return;
  await fetch(NOTIFY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `[${level.toUpperCase()}] paperclip cost-watchdog: ${message}` }),
  }).catch((err: Error) => log.error({ err }, 'webhook failed'));
}

async function tick() {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const { usdSpent } = await fetchAnthropicUsage({ adminKey: KEY, month: ym });
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = (usdSpent / dayOfMonth) * daysInMonth;
  log.info({ usdSpent, projected, capUsd: CAP_USD }, 'cost tick');

  if (projected >= CAP_USD * STOP_PCT) {
    await notify('critical', `projected $${projected.toFixed(2)} >= cap $${CAP_USD}. PAUSE PAPERCLIP NOW.`);
  } else if (projected >= CAP_USD * WARN_PCT) {
    await notify('warn', `projected $${projected.toFixed(2)} >= ${WARN_PCT * 100}% of cap. Investigate.`);
  }
}

cron.schedule('0 8 * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'cost-watchdog tick failed'));
});
tick().catch((err: Error) => log.error({ err }, 'startup tick failed'));
log.info({ capUsd: CAP_USD }, 'cost-watchdog started (daily 08:00 UTC)');
```

- [ ] **Step 6: Run + commit**

```bash
pnpm install
pnpm --filter @paperclip/cost-watchdog test
git add workers/cost-watchdog/ pnpm-lock.yaml
git commit -m "feat(cost-watchdog): daily anthropic usage check with warn/critical webhooks"
```

---

### Task 6: Secret rotation helper

**Files:**
- Create: `scripts/rotate-token.ts`

- [ ] **Step 1: Write `scripts/rotate-token.ts`**

```ts
#!/usr/bin/env tsx
// Re-encrypts all oauth_tokens with a new TOKEN_ENC_KEY.
// Usage:
//   OLD_TOKEN_ENC_KEY=base64:... NEW_TOKEN_ENC_KEY=base64:... tsx scripts/rotate-token.ts
import { db, oauthTokens } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw || !raw.startsWith('base64:')) throw new Error(`${envName} missing or malformed`);
  const buf = Buffer.from(raw.slice('base64:'.length), 'base64');
  if (buf.length !== 32) throw new Error(`${envName} must be 32 bytes`);
  return buf;
}

const oldKey = loadKey('OLD_TOKEN_ENC_KEY');
const newKey = loadKey('NEW_TOKEN_ENC_KEY');

function decrypt(ct: string, nonce: string, key: Buffer): string {
  const data = Buffer.from(ct, 'base64');
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

function encrypt(plain: string, key: Buffer): { ct: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct: Buffer.concat([ct, tag]).toString('base64'), nonce: nonce.toString('base64') };
}

const rows = await db.select().from(oauthTokens);
console.log(`re-encrypting ${rows.length} rows...`);
for (const r of rows) {
  const plain = decrypt(r.encryptedPayload, r.nonce, oldKey);
  const { ct, nonce } = encrypt(plain, newKey);
  await db.update(oauthTokens).set({ encryptedPayload: ct, nonce, updatedAt: new Date() }).where(eq(oauthTokens.id, r.id));
}
console.log('done. Update TOKEN_ENC_KEY in .env, restart all services.');
```

- [ ] **Step 2: Commit**

```bash
git add scripts/rotate-token.ts
git commit -m "feat: add rotate-token.ts to re-encrypt oauth_tokens with new key"
```

---

### Task 7: Healthcheck endpoints + script

**Files:**
- Modify: `apps/web/app/api/health/route.ts`
- Create: `scripts/healthcheck.sh`

- [ ] **Step 1: Create `apps/web/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 503 });
  }
}
```

- [ ] **Step 2: Create `scripts/healthcheck.sh`**

```sh
#!/bin/sh
set -eu
HOST="${1:-https://agency.example.com}"

echo "Checking $HOST..."
curl -fsS "$HOST/api/health" >/dev/null && echo "  /api/health ✓"
curl -fsS "$HOST/health" >/dev/null && echo "  /health (attribution) ✓"
echo "All ok."
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/health scripts/healthcheck.sh
git commit -m "feat: /api/health endpoint + healthcheck.sh"
```

---

### Task 8: VPS bootstrap script

**Files:**
- Create: `infra/deploy/bootstrap.sh`
- Create: `infra/deploy/systemd/paperclip.service`

- [ ] **Step 1: `infra/deploy/bootstrap.sh`** *(idempotent — safe to re-run)*

```sh
#!/bin/bash
set -euo pipefail

# Run on a fresh Ubuntu 24.04 VPS as root or via sudo.
# Usage: curl -fsSL https://raw.githubusercontent.com/<you>/paperclip/main/infra/deploy/bootstrap.sh | sudo bash

# 1. Base packages
apt-get update -y
apt-get install -y \
  curl ca-certificates gnupg ufw fail2ban git \
  unattended-upgrades apt-listchanges

# 2. Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 3. Auto security updates
dpkg-reconfigure -plow unattended-upgrades || true

# 4. Docker
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# 5. App user + dirs
id -u paperclip >/dev/null 2>&1 || useradd -m -s /bin/bash paperclip
usermod -aG docker paperclip
mkdir -p /opt/paperclip /var/log/paperclip
chown -R paperclip:paperclip /opt/paperclip /var/log/paperclip

# 6. systemd unit
cat > /etc/systemd/system/paperclip.service <<'UNIT'
[Unit]
Description=Paperclip Marketing Agency
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/paperclip
ExecStart=/usr/bin/docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml down
User=paperclip
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable paperclip.service

echo "Bootstrap complete. Next steps:"
echo "  sudo -u paperclip git clone <repo> /opt/paperclip"
echo "  populate /opt/paperclip/.env (use .env.example as template)"
echo "  sudo systemctl start paperclip"
```

- [ ] **Step 2: `infra/deploy/systemd/paperclip.service`** (mirrored copy for reference / version control)

Same content as embedded in the bootstrap script above, but committed independently so changes are reviewable.

- [ ] **Step 3: Commit**

```bash
chmod +x infra/deploy/bootstrap.sh
git add infra/deploy/
git commit -m "feat(deploy): VPS bootstrap script + systemd unit"
```

---

### Task 9: Runbook documentation

**Files:**
- Create: `docs/runbook.md`
- Create: `infra/deploy/README.md`

- [ ] **Step 1: `infra/deploy/README.md`**

```markdown
# Deployment

## First-time setup (one VPS, Ubuntu 24.04)

1. Create a VPS. Hetzner CX22 (4GB / 2 vCPU) is enough.
2. Point your DNS A record `agency.example.com` at the VPS IP.
3. SSH in as root.
4. `curl -fsSL https://raw.githubusercontent.com/<you>/paperclip/main/infra/deploy/bootstrap.sh | bash`
5. As `paperclip` user: `git clone <repo> /opt/paperclip`
6. Copy `.env.example` to `/opt/paperclip/.env`. Fill in every value (see Plan 6 secrets list below).
7. `sudo systemctl start paperclip`
8. `curl -fsS https://agency.example.com/api/health` should return `{"ok":true}` after Caddy provisions a cert (~30s).

## Required secrets in `.env`

- `DATABASE_URL` (use internal `postgres:5432`)
- `POSTGRES_PASSWORD` (strong random)
- `TOKEN_ENC_KEY` (`base64:<32 bytes>`)
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_ADMIN_KEY` (admin API, for cost-watchdog)
- `MONTHLY_LLM_CAP_USD` (default 180)
- `WATCHDOG_NOTIFY_URL` (Discord/Slack webhook)
- `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`
- `ATTRIBUTION_WEBHOOK_SECRET` (random; configure in Beehiiv)
- `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`
- `NEWSLETTER_ORIGIN` (e.g., `https://news.example.com`)
- `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`
- `LOGS_TOKEN` (BetterStack)
- `NOTIFIER_TRANSPORT=email`, `SMTP_*`, `NOTIFY_TO`
- `LOG_FILE_DIR=/var/log/paperclip`

## Deploy a new version

```bash
ssh paperclip@agency.example.com
cd /opt/paperclip
git pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
```
```

- [ ] **Step 2: `docs/runbook.md`**

```markdown
# Runbook

## "/api/health is down"
1. SSH in. `sudo systemctl status paperclip`.
2. `cd /opt/paperclip && docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps`
3. Whichever service is unhealthy: `docker compose ... logs <service> --tail=200`.
4. Postgres unhealthy? Check disk: `df -h`. If full, see backup retention.

## "Cost watchdog warned"
1. Check Paperclip dashboard (`https://agency.example.com:8080`) for which agent is burning.
2. Read recent ticket trail in Paperclip. Was there a stuck loop?
3. Tighten the relevant agent's `budget_usd_per_month` in `agents/*.yaml`. Redeploy.
4. If acute, pause Paperclip: `docker compose stop paperclip`. Investigate.

## "I need to restore from backup"
```sh
cd /opt/paperclip
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml exec backup /restore.sh
```
Restart workers: `docker compose ... restart scheduler metrics-collector attribution-mcp notifier paperclip`.

## "X account suspended"
1. Do not auto-recover — investigate first. Don't trigger more API calls.
2. `docker compose stop scheduler` to halt posting.
3. Read X's email. Common causes: too-similar-content, automation flag.
4. Tighten cadence cap (`X_DAILY_CAP=2`), increase jitter, reduce thread length. Redeploy.
5. Wait at least 48h before re-enabling.

## "LinkedIn drafts piling up"
Notifier should ping at 60min stale. If it isn't:
- Confirm `notifier` is running.
- Check `WEB_BASE_URL` env var.
- Check email transport: `docker compose logs notifier --tail=50`.

## "Prompt regression in CI"
1. Look at the failing case's diff in promptfoo output.
2. Re-run locally: `pnpm evals --config evals/<agent>/promptfooconfig.yaml`.
3. Either: revert the prompt change, or add/adjust the failing case if it's outdated.

## Routine: weekly rituals (15 min total)
- Monday: review the new week's briefs.
- Wednesday: empty the queue.
- Friday: read the weekly digest.
- Once/month: rotate `TOKEN_ENC_KEY` via `scripts/rotate-token.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbook.md infra/deploy/README.md
git commit -m "docs: runbook + deployment README"
```

---

### Task 10: BetterStack heartbeat + UptimeRobot synthetic (manual)

**Files:** None — external configuration. Document inline.

- [ ] **Step 1: Set up BetterStack heartbeat URL**

In BetterStack → Monitors → Heartbeats: create one with 15-minute interval. Copy the URL.

- [ ] **Step 2: Add heartbeat to scheduler worker**

Modify `workers/scheduler/src/index.ts`. After each successful `tick()`:

```ts
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

async function tick() {
  // ... existing
  if (HEARTBEAT_URL) {
    await fetch(HEARTBEAT_URL).catch((err: Error) => log.warn({ err }, 'heartbeat failed'));
  }
}
```

- [ ] **Step 3: UptimeRobot — add a synthetic monitor**

URL: `https://agency.example.com/api/health`. Expected body: `{"ok":true}`. 5-min interval. Alert to your email.

- [ ] **Step 4: Document in runbook.md**

Append:

```markdown
## Monitoring

- BetterStack heartbeat (15-min): if scheduler tick fails silently, BetterStack pages within 30 min.
- UptimeRobot synthetic (5-min): /api/health; if web or Postgres is down, page within 10 min.
- BetterStack logs: tail in dashboard, filter by `level=error`.
```

- [ ] **Step 5: Commit**

```bash
git add workers/scheduler/src/index.ts docs/runbook.md
git commit -m "feat: heartbeat URL on successful scheduler ticks + uptime monitoring docs"
```

---

### Task 11: Final end-to-end smoke

**Files:** None — verification only.

- [ ] **Step 1: Provision VPS, run bootstrap**

Follow `infra/deploy/README.md`. Goal: clean install, `/api/health` returns 200 within 15 min of `systemctl start paperclip`.

- [ ] **Step 2: Send a webhook**

```bash
curl -X POST https://agency.example.com/webhook/newsletter \
  -H "authorization: Bearer $ATTRIBUTION_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"type":"subscription.created","data":{"id":"smoke_test","created":'$(date +%s)',"utm_source":"x","utm_campaign":"post_test"}}'
```
Expected: `{"attributed":false,"reason":"draft_not_found"}` (no such draft exists, but the endpoint works).

- [ ] **Step 3: Trigger a backup manually**

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml exec backup /backup.sh
```
Expected: log shows upload to B2.

- [ ] **Step 4: Verify cost-watchdog logs**

```bash
docker compose logs cost-watchdog --tail=20
```
Expected: a daily tick with `usdSpent` and `projected` values.

- [ ] **Step 5: Confirm logs in BetterStack**

Search for `name:scheduler` or `name:cost-watchdog`. Recent events should be visible.

- [ ] **Step 6: No commit; verification only**

---

### Self-Review

**Spec coverage:**
- HTTPS via Caddy — Task 2. ✓
- Encrypted secret storage (already done in Plan 2) — Plan 2 + Task 6 rotation. ✓
- Daily Postgres backups with retention — Task 3. ✓
- Structured logs to aggregator — Task 4. ✓
- Cost watchdog with warn/critical thresholds — Task 5. ✓
- Healthcheck endpoint — Task 7. ✓
- Idempotent VPS bootstrap + systemd — Task 8. ✓
- Runbook + deployment docs — Task 9. ✓
- Uptime monitoring (heartbeat + synthetic) — Task 10. ✓

**Placeholder scan:** `agency.example.com`, `letsencrypt@example.com`, `<repo>`, `<you>`, `news.example.com` are placeholder hostnames/usernames the operator MUST replace. They're called out as such in each file's notes; this is intentional, not a TODO.

**Type consistency:** Env var names consistent across files (`TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY`, `B2_*`, `BEEHIIV_*`, `MONTHLY_LLM_CAP_USD`, etc.). `makeLogger` from `@paperclip/shared` is the single logger factory used everywhere.

**Identified gap:** Caddy's `Caddyfile` reverse-proxies `/webhook/*` to `attribution-mcp:4001` but doesn't enforce the bearer token — the attribution-mcp handler does. That's correct (defense at the right layer), but Caddy could add a rate-limit for the webhook path. The plan does NOT add this — it's a YAGNI choice for v1, easily added later if abuse appears. Documenting this as a known omission, not a missing requirement.

---

### What you have after Plan 6

A real, live, monitored production deployment. HTTPS, off-site daily backups with one-line restore, structured logs in BetterStack, cost-watchdog alerts when spend trends past cap, runbook for the 6 most likely incidents. You can take a 2-week vacation and trust the system. ~11 commits, ~1500 LoC.
