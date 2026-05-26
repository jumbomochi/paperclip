# Plan 2 — X Integration + Stub Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make X (Twitter) posting really work end-to-end against a mocked-then-real X API, with a scheduler worker that posts approved drafts, a metrics-collector worker that snapshots performance, and a stub-agent CLI that walks a brief through the full pipeline using hardcoded content — all *without* any LLM calls. After this ships, you can run `pnpm stub:run-week` and watch fake content travel from briefed → posted on a real X dev account, with metrics rolling in automatically.

**Architecture:** A new `x-mcp` package wraps the X v2 API (Basic tier scope). Two Node workers (`scheduler`, `metrics-collector`) poll Postgres on fixed intervals. A `stub-agents` script package simulates the agency pipeline by directly invoking the tool functions of `drafts-mcp`. All external HTTP is mocked in unit tests via `msw`; a separate "live" eval can be enabled by env var.

**Tech Stack:** Same as Plan 1 + `twitter-api-v2`, `msw`, `node-cron`, `dotenv`, `pino` (structured logging), `nanoid`.

**Depends on:** Plan 1 (foundation) complete.

---

## File Structure

```
paperclip/
├── infra/docker-compose.yml                  # +scheduler, +metrics-collector services
├── .env.example                              # NEW: X_API_KEY, X_API_SECRET, ...
├── packages/
│   └── shared/                               # NEW: shared types + token store
│       ├── package.json                      # @paperclip/shared
│       ├── src/
│       │   ├── tokens.ts                     # encrypted token store (Postgres-backed)
│       │   ├── logger.ts                     # pino logger factory
│       │   └── index.ts
│       └── tests/tokens.test.ts
├── db/
│   ├── src/schema.ts                         # +oauth_tokens table
│   └── migrations/0001_*                     # generated
├── mcp/
│   └── x-mcp/
│       ├── package.json                      # @paperclip/x-mcp
│       ├── tsconfig.json
│       ├── src/
│       │   ├── server.ts                     # MCP stdio entrypoint
│       │   ├── client.ts                     # twitter-api-v2 wrapper (per-account)
│       │   ├── readCache.ts                  # postgres-backed cache for X reads
│       │   ├── tools/
│       │   │   ├── postTweet.ts
│       │   │   ├── postThread.ts
│       │   │   ├── readTweetMetrics.ts
│       │   │   └── searchTopPosts.ts
│       │   └── rateLimit.ts                  # in-memory budget + DB-backed monthly cap
│       └── tests/
│           ├── postTweet.test.ts             # uses msw
│           ├── readTweetMetrics.test.ts      # uses msw
│           └── rateLimit.test.ts
├── workers/
│   ├── scheduler/
│   │   ├── package.json                      # @paperclip/scheduler
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                      # node-cron loop entrypoint
│   │   │   ├── postReady.ts                  # posts approved drafts (X)
│   │   │   ├── notifyAwaitingPaste.ts        # stub for Plan 3
│   │   │   └── enqueueSnapshots.ts           # writes 5 metrics_jobs per post
│   │   └── tests/postReady.test.ts
│   └── metrics-collector/
│       ├── package.json                      # @paperclip/metrics-collector
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts                      # poll loop
│       │   └── runOne.ts                     # process a single metrics_job
│       └── tests/runOne.test.ts
└── scripts/
    └── stub-agents/
        ├── package.json                      # @paperclip/stub-agents
        ├── tsconfig.json
        └── src/
            ├── runWeek.ts                    # CLI: runs a full simulated week
            ├── researcher.ts                 # produces canned research
            ├── copywriter.ts                 # produces canned drafts
            └── editor.ts                     # always-approves stub
```

**Key boundaries:**

- `x-mcp` is the only place that imports `twitter-api-v2`. Every read/write through it is rate-limit-aware and uses Postgres caching for reads (the Basic tier read limit is the binding constraint).
- `scheduler` and `metrics-collector` are independent processes; they share nothing in memory and only coordinate through Postgres (`metrics_jobs` table, `drafts.status`).
- `stub-agents` exists to exercise the full pipeline without burning LLM tokens. **It must call exactly the same tool functions real Paperclip agents will call in Plan 4** so the test surface stays honest.

---

### Task 1: Add `oauth_tokens` table for encrypted credential storage

**Files:**
- Modify: `db/src/schema.ts`
- Create: migration (auto-generated)

- [ ] **Step 1: Append `oauthTokens` table to `db/src/schema.ts`**

```ts
// Append after existing tables in db/src/schema.ts:
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account: text('account').notNull(),       // logical name, e.g. 'newsletter_main'
    platform: text('platform').notNull(),     // 'x' | 'linkedin' | 'newsletter'
    encryptedPayload: text('encrypted_payload').notNull(),
    nonce: text('nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountPlatform: unique('oauth_tokens_account_platform').on(t.account, t.platform),
  }),
);
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm --filter @paperclip/db generate
pnpm --filter @paperclip/db migrate
```
Expected: new `0001_*.sql` file; table appears in `\dt` output.

- [ ] **Step 3: Commit**

```bash
git add db/src/schema.ts db/migrations/
git commit -m "feat(db): add oauth_tokens table for encrypted credential storage"
```

---

### Task 2: `@paperclip/shared` package with token store + logger

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/tokens.ts`
- Create: `packages/shared/src/logger.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/tokens.test.ts`
- Modify: `pnpm-workspace.yaml`
- Create: `.env.example`

- [ ] **Step 1: Add `packages/*` to `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'db'
  - 'mcp/*'
  - 'packages/*'
  - 'scripts/*'
  - 'workers/*'
```

- [ ] **Step 2: Write `packages/shared/package.json`**

```json
{
  "name": "@paperclip/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "drizzle-orm": "0.36.0",
    "pino": "9.5.0"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 3: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Write `packages/shared/src/logger.ts`**

```ts
import pino from 'pino';

export function makeLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.LOG_PRETTY === '1' ? { target: 'pino-pretty' } : undefined,
  });
}
```

- [ ] **Step 5: Write `.env.example` at repo root**

```env
DATABASE_URL=postgres://paperclip:paperclip_dev@localhost:5433/paperclip
TOKEN_ENC_KEY=base64:CHANGE_ME_32_BYTES_BASE64
LOG_LEVEL=info
LOG_PRETTY=1

# X (Twitter) — set in real env, not .env.local
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
X_BEARER=
```

- [ ] **Step 6: Write failing test `packages/shared/tests/tokens.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db, oauthTokens } from '@paperclip/db';
import { storeToken, loadToken } from '../src/tokens.js';

const key = randomBytes(32).toString('base64');

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = `base64:${key}`;
});

beforeEach(async () => {
  await db.delete(oauthTokens);
});

describe('tokens', () => {
  it('round-trips a token through storeToken/loadToken', async () => {
    await storeToken({ account: 'newsletter_main', platform: 'x', payload: { accessToken: 'abc', refreshToken: 'def' } });
    const loaded = await loadToken({ account: 'newsletter_main', platform: 'x' });
    expect(loaded).toEqual({ accessToken: 'abc', refreshToken: 'def' });
  });

  it('updates existing token on second store', async () => {
    await storeToken({ account: 'a', platform: 'x', payload: { v: 1 } });
    await storeToken({ account: 'a', platform: 'x', payload: { v: 2 } });
    expect(await loadToken({ account: 'a', platform: 'x' })).toEqual({ v: 2 });
  });

  it('loadToken returns null when missing', async () => {
    expect(await loadToken({ account: 'missing', platform: 'x' })).toBeNull();
  });

  it('throws when TOKEN_ENC_KEY is missing', async () => {
    const old = process.env.TOKEN_ENC_KEY;
    delete process.env.TOKEN_ENC_KEY;
    await expect(storeToken({ account: 'a', platform: 'x', payload: { v: 1 } })).rejects.toThrow(
      /TOKEN_ENC_KEY/,
    );
    process.env.TOKEN_ENC_KEY = old;
  });
});
```

- [ ] **Step 7: Run, expect failure**

Run: `pnpm install && pnpm --filter @paperclip/shared test`
Expected: missing module errors.

- [ ] **Step 8: Implement `packages/shared/src/tokens.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db, oauthTokens } from '@paperclip/db';
import { and, eq } from 'drizzle-orm';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) throw new Error('TOKEN_ENC_KEY missing');
  if (!raw.startsWith('base64:')) throw new Error('TOKEN_ENC_KEY must start with base64:');
  const buf = Buffer.from(raw.slice('base64:'.length), 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_ENC_KEY must decode to 32 bytes');
  return buf;
}

function encrypt(plain: string): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

function decrypt(ciphertext: string, nonce: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export async function storeToken<T>(input: { account: string; platform: string; payload: T }): Promise<void> {
  const { ciphertext, nonce } = encrypt(JSON.stringify(input.payload));
  const existing = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.account, input.account), eq(oauthTokens.platform, input.platform)));
  if (existing.length > 0) {
    await db
      .update(oauthTokens)
      .set({ encryptedPayload: ciphertext, nonce, updatedAt: new Date() })
      .where(eq(oauthTokens.id, existing[0]!.id));
  } else {
    await db.insert(oauthTokens).values({
      account: input.account,
      platform: input.platform,
      encryptedPayload: ciphertext,
      nonce,
    });
  }
}

export async function loadToken<T>(input: { account: string; platform: string }): Promise<T | null> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.account, input.account), eq(oauthTokens.platform, input.platform)));
  if (!row) return null;
  return JSON.parse(decrypt(row.encryptedPayload, row.nonce)) as T;
}
```

- [ ] **Step 9: Write `packages/shared/src/index.ts`**

```ts
export * from './tokens.js';
export * from './logger.js';
```

- [ ] **Step 10: Run tests**

Run: `pnpm --filter @paperclip/shared test`
Expected: 4 tests PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/ pnpm-workspace.yaml .env.example pnpm-lock.yaml
git commit -m "feat(shared): add @paperclip/shared with encrypted token store + logger"
```

---

### Task 3: `x-mcp` rate-limit module (TDD)

**Files:**
- Create: `mcp/x-mcp/package.json`
- Create: `mcp/x-mcp/tsconfig.json`
- Create: `mcp/x-mcp/src/rateLimit.ts`
- Create: `mcp/x-mcp/tests/rateLimit.test.ts`

- [ ] **Step 1: Write `mcp/x-mcp/package.json`**

```json
{
  "name": "@paperclip/x-mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "src/server.ts",
  "bin": { "x-mcp": "dist/server.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.0.4",
    "@paperclip/db": "workspace:*",
    "@paperclip/shared": "workspace:*",
    "drizzle-orm": "0.36.0",
    "twitter-api-v2": "1.18.2",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "msw": "2.4.9",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: Write `mcp/x-mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "compilerOptions": { "outDir": "dist" }
}
```

- [ ] **Step 3: Write failing test `mcp/x-mcp/tests/rateLimit.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MonthlyBudget, BudgetExceededError } from '../src/rateLimit.js';

describe('MonthlyBudget', () => {
  let budget: MonthlyBudget;
  beforeEach(() => {
    budget = new MonthlyBudget({ kind: 'reads', cap: 5 });
  });

  it('records consumption and reports remaining', () => {
    budget.consume(2);
    expect(budget.remaining()).toBe(3);
  });

  it('throws when about to exceed cap', () => {
    budget.consume(4);
    expect(() => budget.consume(2)).toThrow(BudgetExceededError);
  });

  it('does not throw on exactly hitting the cap', () => {
    expect(() => budget.consume(5)).not.toThrow();
    expect(budget.remaining()).toBe(0);
  });

  it('resets on month rollover', () => {
    budget.consume(5);
    budget.setNow(new Date('2030-01-01'));
    expect(budget.remaining()).toBe(5);
  });
});
```

- [ ] **Step 4: Run, expect failure**

Run: `pnpm install && pnpm --filter @paperclip/x-mcp test`
Expected: module not found.

- [ ] **Step 5: Implement `mcp/x-mcp/src/rateLimit.ts`**

```ts
export class BudgetExceededError extends Error {
  constructor(public kind: string, public cap: number) {
    super(`monthly ${kind} budget exceeded (cap=${cap})`);
  }
}

interface BudgetState {
  used: number;
  monthKey: string;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class MonthlyBudget {
  private state: BudgetState;
  private now: () => Date = () => new Date();

  constructor(private readonly opts: { kind: string; cap: number }) {
    this.state = { used: 0, monthKey: monthKey(this.now()) };
  }

  setNow(d: Date) { this.now = () => d; this.rollIfNeeded(); }

  private rollIfNeeded() {
    const m = monthKey(this.now());
    if (m !== this.state.monthKey) this.state = { used: 0, monthKey: m };
  }

  consume(n: number): void {
    this.rollIfNeeded();
    if (this.state.used + n > this.opts.cap) {
      throw new BudgetExceededError(this.opts.kind, this.opts.cap);
    }
    this.state.used += n;
  }

  remaining(): number {
    this.rollIfNeeded();
    return Math.max(0, this.opts.cap - this.state.used);
  }
}
```

- [ ] **Step 6: Run tests, expect pass**

Run: `pnpm --filter @paperclip/x-mcp test`
Expected: 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/x-mcp/package.json mcp/x-mcp/tsconfig.json mcp/x-mcp/src/rateLimit.ts mcp/x-mcp/tests/rateLimit.test.ts pnpm-lock.yaml
git commit -m "feat(x-mcp): add MonthlyBudget rate-limit primitive"
```

---

### Task 4: `x-mcp` client wrapper + `postTweet` (TDD with msw)

**Files:**
- Create: `mcp/x-mcp/src/client.ts`
- Create: `mcp/x-mcp/src/tools/postTweet.ts`
- Create: `mcp/x-mcp/tests/postTweet.test.ts`
- Create: `mcp/x-mcp/tests/msw-setup.ts`

- [ ] **Step 1: Write `mcp/x-mcp/tests/msw-setup.ts`**

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const server = setupServer();
export { http, HttpResponse };
```

- [ ] **Step 2: Write failing test `mcp/x-mcp/tests/postTweet.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { server, http, HttpResponse } from './msw-setup.js';
import { postTweet } from '../src/tools/postTweet.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeCreds = {
  appKey: 'k',
  appSecret: 's',
  accessToken: 'a',
  accessSecret: 'b',
};

describe('postTweet', () => {
  it('posts a tweet and returns id + url', async () => {
    server.use(
      http.post('https://api.twitter.com/2/tweets', async ({ request }) => {
        const body = (await request.json()) as { text: string };
        expect(body.text).toBe('Hello world');
        return HttpResponse.json({ data: { id: '1234567890', text: body.text } });
      }),
    );

    const out = await postTweet({ account: 'test', text: 'Hello world', creds: fakeCreds });
    expect(out.id).toBe('1234567890');
    expect(out.url).toBe('https://x.com/i/web/status/1234567890');
  });

  it('rejects when text exceeds 280 chars', async () => {
    await expect(
      postTweet({ account: 'test', text: 'a'.repeat(281), creds: fakeCreds }),
    ).rejects.toThrow(/too long/i);
  });

  it('surfaces upstream error', async () => {
    server.use(
      http.post('https://api.twitter.com/2/tweets', () =>
        HttpResponse.json({ errors: [{ message: 'rate limited' }] }, { status: 429 }),
      ),
    );
    await expect(postTweet({ account: 'test', text: 'hi', creds: fakeCreds })).rejects.toThrow(/rate limited|429/i);
  });
});
```

- [ ] **Step 3: Run, expect fail**

Run: `pnpm --filter @paperclip/x-mcp test`
Expected: import error.

- [ ] **Step 4: Implement `mcp/x-mcp/src/client.ts`**

```ts
import { TwitterApi } from 'twitter-api-v2';

export interface XCreds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export function makeClient(creds: XCreds): TwitterApi {
  return new TwitterApi(creds);
}
```

- [ ] **Step 5: Implement `mcp/x-mcp/src/tools/postTweet.ts`**

```ts
import { makeClient, type XCreds } from '../client.js';

export interface PostTweetInput {
  account: string;
  text: string;
  inReplyTo?: string;
  creds: XCreds;
}

export interface PostTweetOutput {
  id: string;
  url: string;
}

export async function postTweet(input: PostTweetInput): Promise<PostTweetOutput> {
  if (input.text.length > 280) {
    throw new Error(`tweet text too long: ${input.text.length} > 280`);
  }
  const client = makeClient(input.creds);
  const v2 = client.v2;
  const resp = await v2.tweet(input.text, input.inReplyTo ? { reply: { in_reply_to_tweet_id: input.inReplyTo } } : undefined);
  if (!resp.data?.id) {
    throw new Error(`x post failed: ${JSON.stringify(resp)}`);
  }
  return { id: resp.data.id, url: `https://x.com/i/web/status/${resp.data.id}` };
}
```

- [ ] **Step 6: Run, expect pass**

Run: `pnpm --filter @paperclip/x-mcp test`
Expected: 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/x-mcp/src/client.ts mcp/x-mcp/src/tools/postTweet.ts mcp/x-mcp/tests/postTweet.test.ts mcp/x-mcp/tests/msw-setup.ts
git commit -m "feat(x-mcp): add postTweet with HTTP-mocked tests"
```

---

### Task 5: `x-mcp` `readTweetMetrics` + read-cache (TDD)

**Files:**
- Create: `mcp/x-mcp/src/readCache.ts`
- Create: `mcp/x-mcp/src/tools/readTweetMetrics.ts`
- Create: `mcp/x-mcp/tests/readTweetMetrics.test.ts`
- Modify: `db/src/schema.ts` (add `x_read_cache` table)

- [ ] **Step 1: Add cache table to `db/src/schema.ts`**

```ts
export const xReadCache = pgTable(
  'x_read_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    body: jsonb('body').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm --filter @paperclip/db generate
pnpm --filter @paperclip/db migrate
```

- [ ] **Step 3: Write failing test `mcp/x-mcp/tests/readTweetMetrics.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { server, http, HttpResponse } from './msw-setup.js';
import { db, xReadCache } from '@paperclip/db';
import { readTweetMetrics } from '../src/tools/readTweetMetrics.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  await db.delete(xReadCache);
});

const fakeCreds = { appKey: 'k', appSecret: 's', accessToken: 'a', accessSecret: 'b' };

describe('readTweetMetrics', () => {
  it('fetches metrics from X and caches', async () => {
    let hits = 0;
    server.use(
      http.get('https://api.twitter.com/2/tweets/12345', () => {
        hits++;
        return HttpResponse.json({
          data: {
            id: '12345',
            text: 'hi',
            public_metrics: { impression_count: 1000, like_count: 50, retweet_count: 5, reply_count: 2, quote_count: 1 },
          },
        });
      }),
    );

    const first = await readTweetMetrics({ tweetId: '12345', creds: fakeCreds, maxAgeSeconds: 60 });
    expect(first.impressions).toBe(1000);
    expect(first.engagement).toBe(50 + 5 + 2 + 1);
    expect(hits).toBe(1);

    const second = await readTweetMetrics({ tweetId: '12345', creds: fakeCreds, maxAgeSeconds: 60 });
    expect(second.impressions).toBe(1000);
    expect(hits).toBe(1); // served from cache
  });

  it('refetches when cache is stale', async () => {
    let hits = 0;
    server.use(
      http.get('https://api.twitter.com/2/tweets/12345', () => {
        hits++;
        return HttpResponse.json({
          data: { id: '12345', text: 'hi', public_metrics: { impression_count: hits * 100, like_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0 } },
        });
      }),
    );

    await readTweetMetrics({ tweetId: '12345', creds: fakeCreds, maxAgeSeconds: 0 });
    await readTweetMetrics({ tweetId: '12345', creds: fakeCreds, maxAgeSeconds: 0 });
    expect(hits).toBe(2);
  });
});
```

- [ ] **Step 4: Run, expect failure**

Run: `pnpm --filter @paperclip/x-mcp test`

- [ ] **Step 5: Implement `mcp/x-mcp/src/readCache.ts`**

```ts
import { db, xReadCache } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export async function cached<T>(
  key: string,
  maxAgeSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const [row] = await db.select().from(xReadCache).where(eq(xReadCache.cacheKey, key));
  if (row && Date.now() - row.fetchedAt.getTime() < maxAgeSeconds * 1000) {
    return row.body as T;
  }
  const fresh = await fetcher();
  await db
    .insert(xReadCache)
    .values({ cacheKey: key, body: fresh as object, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: xReadCache.cacheKey,
      set: { body: fresh as object, fetchedAt: new Date() },
    });
  return fresh;
}
```

- [ ] **Step 6: Implement `mcp/x-mcp/src/tools/readTweetMetrics.ts`**

```ts
import { makeClient, type XCreds } from '../client.js';
import { cached } from '../readCache.js';

export interface ReadTweetMetricsInput {
  tweetId: string;
  creds: XCreds;
  maxAgeSeconds?: number;
}

export interface ReadTweetMetricsOutput {
  tweetId: string;
  impressions: number;
  engagement: number;
  raw: unknown;
}

export async function readTweetMetrics(input: ReadTweetMetricsInput): Promise<ReadTweetMetricsOutput> {
  const ttl = input.maxAgeSeconds ?? 600;
  const body = await cached(`tweet:${input.tweetId}`, ttl, async () => {
    const client = makeClient(input.creds);
    const r = await client.v2.singleTweet(input.tweetId, {
      'tweet.fields': ['public_metrics'],
    });
    return r;
  });
  const m = (body as { data?: { public_metrics?: Record<string, number> } }).data?.public_metrics ?? {};
  return {
    tweetId: input.tweetId,
    impressions: m.impression_count ?? 0,
    engagement: (m.like_count ?? 0) + (m.retweet_count ?? 0) + (m.reply_count ?? 0) + (m.quote_count ?? 0),
    raw: body,
  };
}
```

- [ ] **Step 7: Run, expect pass**

Run: `pnpm --filter @paperclip/x-mcp test`
Expected: all 5 X-MCP tests PASS.

- [ ] **Step 8: Commit**

```bash
git add db/src/schema.ts db/migrations/ mcp/x-mcp/src/readCache.ts mcp/x-mcp/src/tools/readTweetMetrics.ts mcp/x-mcp/tests/readTweetMetrics.test.ts
git commit -m "feat(x-mcp): add readTweetMetrics with postgres-backed read cache"
```

---

### Task 6: `x-mcp` `postThread` + `searchTopPosts`

**Files:**
- Create: `mcp/x-mcp/src/tools/postThread.ts`
- Create: `mcp/x-mcp/src/tools/searchTopPosts.ts`
- Create: `mcp/x-mcp/tests/postThread.test.ts`

- [ ] **Step 1: Failing test `mcp/x-mcp/tests/postThread.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { server, http, HttpResponse } from './msw-setup.js';
import { postThread } from '../src/tools/postThread.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fakeCreds = { appKey: 'k', appSecret: 's', accessToken: 'a', accessSecret: 'b' };

describe('postThread', () => {
  it('posts each tweet, chaining replies', async () => {
    const ids = ['11', '22', '33'];
    let i = 0;
    server.use(
      http.post('https://api.twitter.com/2/tweets', async ({ request }) => {
        const body = (await request.json()) as { text: string; reply?: { in_reply_to_tweet_id: string } };
        if (i === 0) expect(body.reply).toBeUndefined();
        if (i > 0) expect(body.reply?.in_reply_to_tweet_id).toBe(ids[i - 1]);
        const id = ids[i++]!;
        return HttpResponse.json({ data: { id, text: body.text } });
      }),
    );

    const result = await postThread({
      account: 'test',
      tweets: ['first', 'second', 'third'],
      creds: fakeCreds,
    });
    expect(result.ids).toEqual(['11', '22', '33']);
    expect(result.rootUrl).toBe('https://x.com/i/web/status/11');
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `mcp/x-mcp/src/tools/postThread.ts`**

```ts
import { postTweet, type PostTweetInput } from './postTweet.js';

export interface PostThreadInput {
  account: string;
  tweets: string[];
  creds: PostTweetInput['creds'];
}

export interface PostThreadOutput {
  ids: string[];
  rootUrl: string;
}

export async function postThread(input: PostThreadInput): Promise<PostThreadOutput> {
  if (input.tweets.length === 0) throw new Error('thread is empty');
  const ids: string[] = [];
  let inReplyTo: string | undefined;
  for (const text of input.tweets) {
    const r = await postTweet({ account: input.account, text, inReplyTo, creds: input.creds });
    ids.push(r.id);
    inReplyTo = r.id;
  }
  return { ids, rootUrl: `https://x.com/i/web/status/${ids[0]}` };
}
```

- [ ] **Step 4: Implement `mcp/x-mcp/src/tools/searchTopPosts.ts`**

```ts
import { makeClient, type XCreds } from '../client.js';
import { cached } from '../readCache.js';

export interface SearchTopPostsInput {
  query: string;
  creds: XCreds;
  maxAgeSeconds?: number;
}

export async function searchTopPosts(input: SearchTopPostsInput) {
  const ttl = input.maxAgeSeconds ?? 3600;
  return cached(`search:${input.query}`, ttl, async () => {
    const client = makeClient(input.creds);
    const r = await client.v2.search(input.query, {
      'tweet.fields': ['public_metrics', 'created_at'],
      max_results: 20,
      sort_order: 'relevancy',
    });
    return r.data?.data ?? [];
  });
}
```

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @paperclip/x-mcp test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp/x-mcp/src/tools/postThread.ts mcp/x-mcp/src/tools/searchTopPosts.ts mcp/x-mcp/tests/postThread.test.ts
git commit -m "feat(x-mcp): add postThread and searchTopPosts"
```

---

### Task 7: `x-mcp` stdio MCP server entrypoint

**Files:**
- Create: `mcp/x-mcp/src/server.ts`

- [ ] **Step 1: Implement `mcp/x-mcp/src/server.ts`**

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadToken } from '@paperclip/shared';
import { postTweet } from './tools/postTweet.js';
import { postThread } from './tools/postThread.js';
import { readTweetMetrics } from './tools/readTweetMetrics.js';
import { searchTopPosts } from './tools/searchTopPosts.js';
import type { XCreds } from './client.js';

async function credsFor(account: string): Promise<XCreds> {
  const t = await loadToken<XCreds>({ account, platform: 'x' });
  if (!t) throw new Error(`no X creds for account=${account}`);
  return t;
}

const postTweetSchema = z.object({ account: z.string(), text: z.string() });
const postThreadSchema = z.object({ account: z.string(), tweets: z.array(z.string()).min(1) });
const readMetricsSchema = z.object({ account: z.string(), tweetId: z.string(), maxAgeSeconds: z.number().optional() });
const searchSchema = z.object({ account: z.string(), query: z.string(), maxAgeSeconds: z.number().optional() });

const server = new Server({ name: 'x-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'postTweet', description: 'Post a single tweet', inputSchema: { type: 'object' } },
    { name: 'postThread', description: 'Post a thread (replies chained)', inputSchema: { type: 'object' } },
    { name: 'readTweetMetrics', description: 'Fetch public_metrics for a tweet (cached)', inputSchema: { type: 'object' } },
    { name: 'searchTopPosts', description: 'Search relevant top posts (cached)', inputSchema: { type: 'object' } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'postTweet': {
        const v = postTweetSchema.parse(args);
        result = await postTweet({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'postThread': {
        const v = postThreadSchema.parse(args);
        result = await postThread({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'readTweetMetrics': {
        const v = readMetricsSchema.parse(args);
        result = await readTweetMetrics({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'searchTopPosts': {
        const v = searchSchema.parse(args);
        result = await searchTopPosts({ ...v, creds: await credsFor(v.account) });
        break;
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build, verify entrypoint shape**

```bash
pnpm --filter @paperclip/x-mcp build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/x-mcp/dist/server.js
```
Expected: JSON with 4 tools.

- [ ] **Step 3: Commit**

```bash
git add mcp/x-mcp/src/server.ts
git commit -m "feat(x-mcp): add stdio MCP server entrypoint"
```

---

### Task 8: Scheduler worker — `postReady` (TDD)

**Files:**
- Create: `workers/scheduler/package.json`
- Create: `workers/scheduler/tsconfig.json`
- Create: `workers/scheduler/src/postReady.ts`
- Create: `workers/scheduler/src/enqueueSnapshots.ts`
- Create: `workers/scheduler/tests/postReady.test.ts`

- [ ] **Step 1: Write `workers/scheduler/package.json`**

```json
{
  "name": "@paperclip/scheduler",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "bin": { "scheduler": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "@paperclip/shared": "workspace:*",
    "@paperclip/x-mcp": "workspace:*",
    "drizzle-orm": "0.36.0",
    "node-cron": "3.0.3"
  },
  "devDependencies": {
    "@types/node-cron": "3.0.11",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: Write `workers/scheduler/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "compilerOptions": { "outDir": "dist" }
}
```

- [ ] **Step 3: Write failing test `workers/scheduler/tests/postReady.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, draftTransitions, metricsJobs, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { postReady } from '../src/postReady.js';

beforeEach(async () => {
  await db.delete(metricsJobs);
  await db.delete(draftTransitions);
  await db.delete(drafts);
});

describe('postReady', () => {
  it('posts approved X drafts and transitions to posted, enqueues 5 metrics jobs', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'ready to fly',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();

    const postFn = vi.fn().mockResolvedValue({ id: '999', url: 'https://x.com/i/web/status/999' });
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });

    expect(postFn).toHaveBeenCalledOnce();
    const [after] = await db.select().from(drafts).where(eq(drafts.id, draft!.id));
    expect(after!.status).toBe(DraftStatus.Posted);
    expect(after!.platformPostId).toBe('999');
    expect(after!.platformPostUrl).toBe('https://x.com/i/web/status/999');

    const jobs = await db.select().from(metricsJobs).where(eq(metricsJobs.draftId, draft!.id));
    expect(jobs).toHaveLength(5);
  });

  it('skips drafts not yet due', async () => {
    await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'not yet',
        scheduledFor: new Date(Date.now() + 10 * 60_000),
      });
    const postFn = vi.fn();
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });
    expect(postFn).not.toHaveBeenCalled();
  });

  it('marks post_failed and records reason on error', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'will fail',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();
    const postFn = vi.fn().mockRejectedValue(new Error('boom'));
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });

    const [after] = await db.select().from(drafts).where(eq(drafts.id, draft!.id));
    expect(after!.status).toBe(DraftStatus.PostFailed);
  });
});
```

- [ ] **Step 4: Run, expect failure**

```bash
pnpm install
pnpm --filter @paperclip/scheduler test
```

- [ ] **Step 5: Implement `workers/scheduler/src/enqueueSnapshots.ts`**

```ts
import { db, metricsJobs } from '@paperclip/db';

export const SNAPSHOT_OFFSETS_MIN = [60, 6 * 60, 24 * 60, 72 * 60, 7 * 24 * 60];

export async function enqueueSnapshots(draftId: string, postedAt: Date) {
  await db.insert(metricsJobs).values(
    SNAPSHOT_OFFSETS_MIN.map((m) => ({
      draftId,
      runAt: new Date(postedAt.getTime() + m * 60_000),
    })),
  );
}
```

- [ ] **Step 6: Implement `workers/scheduler/src/postReady.ts`**

```ts
import { db, drafts, draftTransitions, DraftStatus, Platform } from '@paperclip/db';
import { and, eq, lte, inArray } from 'drizzle-orm';
import { enqueueSnapshots } from './enqueueSnapshots.js';

export interface PostReadyDeps {
  now: Date;
  platforms: Platform[];
  postX: (input: { account: string; text: string }) => Promise<{ id: string; url: string }>;
}

const ACCOUNT = 'newsletter_main';

export async function postReady(deps: PostReadyDeps): Promise<void> {
  const due = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.status, DraftStatus.Approved),
        inArray(drafts.platform, deps.platforms),
        lte(drafts.scheduledFor, deps.now),
      ),
    );

  for (const d of due) {
    if (d.platform !== Platform.X) continue; // LinkedIn handled in Plan 3
    try {
      const out = await deps.postX({ account: ACCOUNT, text: d.body });
      await db.transaction(async (tx) => {
        await tx
          .update(drafts)
          .set({
            status: DraftStatus.Posted,
            platformPostId: out.id,
            platformPostUrl: out.url,
            postedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(drafts.id, d.id));
        await tx.insert(draftTransitions).values({
          draftId: d.id,
          fromStatus: DraftStatus.Approved,
          toStatus: DraftStatus.Posted,
          actor: 'scheduler',
        });
      });
      await enqueueSnapshots(d.id, new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.transaction(async (tx) => {
        await tx
          .update(drafts)
          .set({ status: DraftStatus.PostFailed, updatedAt: new Date() })
          .where(eq(drafts.id, d.id));
        await tx.insert(draftTransitions).values({
          draftId: d.id,
          fromStatus: DraftStatus.Approved,
          toStatus: DraftStatus.PostFailed,
          actor: 'scheduler',
          reason: message,
        });
      });
    }
  }
}
```

- [ ] **Step 7: Run tests, expect pass**

Run: `pnpm --filter @paperclip/scheduler test`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add workers/scheduler/package.json workers/scheduler/tsconfig.json workers/scheduler/src/postReady.ts workers/scheduler/src/enqueueSnapshots.ts workers/scheduler/tests/postReady.test.ts pnpm-lock.yaml
git commit -m "feat(scheduler): add postReady with snapshot enqueue (TDD against drafts table)"
```

---

### Task 9: Scheduler entrypoint with node-cron loop

**Files:**
- Create: `workers/scheduler/src/index.ts`
- Create: `workers/scheduler/src/notifyAwaitingPaste.ts`

- [ ] **Step 1: Write `workers/scheduler/src/notifyAwaitingPaste.ts` (stub for Plan 3)**

```ts
import { makeLogger } from '@paperclip/shared';
const log = makeLogger('scheduler.notifyAwaitingPaste');

export async function notifyAwaitingPaste(): Promise<void> {
  // Implemented in Plan 3 — LinkedIn paste flow.
  log.debug('notifyAwaitingPaste: noop in Plan 2');
}
```

- [ ] **Step 2: Write `workers/scheduler/src/index.ts`**

```ts
import cron from 'node-cron';
import { Platform } from '@paperclip/db';
import { makeLogger, loadToken } from '@paperclip/shared';
import { postTweet, type XCreds } from '@paperclip/x-mcp';
import { postReady } from './postReady.js';
import { notifyAwaitingPaste } from './notifyAwaitingPaste.js';

const log = makeLogger('scheduler');
const ACCOUNT = 'newsletter_main';

async function tick() {
  log.info('tick');
  const creds = await loadToken<XCreds>({ account: ACCOUNT, platform: 'x' });
  if (!creds) {
    log.error('no X creds; skipping');
    return;
  }
  await postReady({
    now: new Date(),
    platforms: [Platform.X],
    postX: ({ account, text }) => postTweet({ account, text, creds }),
  });
  await notifyAwaitingPaste();
}

cron.schedule('*/15 * * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'scheduler tick error'));
});

// also run once on boot
tick().catch((err: Error) => log.error({ err }, 'scheduler startup tick error'));

log.info('scheduler started (every 15m)');
```

- [ ] **Step 3: Export `postTweet` + `XCreds` from `mcp/x-mcp/src/server.ts` package**

Modify `mcp/x-mcp/package.json` "main" to `src/index.ts`, and create `mcp/x-mcp/src/index.ts`:

```ts
export { postTweet } from './tools/postTweet.js';
export { postThread } from './tools/postThread.js';
export { readTweetMetrics } from './tools/readTweetMetrics.js';
export { searchTopPosts } from './tools/searchTopPosts.js';
export type { XCreds } from './client.js';
```

(Keep `bin.x-mcp` pointing at `dist/server.js`.)

- [ ] **Step 4: Typecheck and build**

```bash
pnpm --filter @paperclip/scheduler typecheck
pnpm --filter @paperclip/x-mcp build
pnpm --filter @paperclip/scheduler build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add workers/scheduler/src/index.ts workers/scheduler/src/notifyAwaitingPaste.ts mcp/x-mcp/src/index.ts mcp/x-mcp/package.json
git commit -m "feat(scheduler): add node-cron loop entrypoint + reusable x-mcp exports"
```

---

### Task 10: Metrics-collector worker (TDD)

**Files:**
- Create: `workers/metrics-collector/package.json`
- Create: `workers/metrics-collector/tsconfig.json`
- Create: `workers/metrics-collector/src/runOne.ts`
- Create: `workers/metrics-collector/src/index.ts`
- Create: `workers/metrics-collector/tests/runOne.test.ts`

- [ ] **Step 1: Write `workers/metrics-collector/package.json`**

```json
{
  "name": "@paperclip/metrics-collector",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "bin": { "metrics-collector": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "@paperclip/shared": "workspace:*",
    "@paperclip/x-mcp": "workspace:*",
    "drizzle-orm": "0.36.0"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: Write `workers/metrics-collector/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "compilerOptions": { "outDir": "dist" }
}
```

- [ ] **Step 3: Failing test `workers/metrics-collector/tests/runOne.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, metricsJobs, postMetricsSnapshots, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { runOne } from '../src/runOne.js';

beforeEach(async () => {
  await db.delete(postMetricsSnapshots);
  await db.delete(metricsJobs);
  await db.delete(drafts);
});

describe('runOne', () => {
  it('reads metrics for a posted draft and writes a snapshot', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Posted,
        body: 'b',
        platformPostId: '999',
      })
      .returning();
    const [job] = await db
      .insert(metricsJobs)
      .values({ draftId: draft!.id, runAt: new Date() })
      .returning();

    const readFn = vi.fn().mockResolvedValue({
      tweetId: '999',
      impressions: 100,
      engagement: 9,
      raw: { hi: 'mock' },
    });

    await runOne({ jobId: job!.id, readX: readFn });

    const snaps = await db.select().from(postMetricsSnapshots).where(eq(postMetricsSnapshots.draftId, draft!.id));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(100);
    expect(snaps[0]!.engagement).toBe(9);

    const [updatedJob] = await db.select().from(metricsJobs).where(eq(metricsJobs.id, job!.id));
    expect(updatedJob!.status).toBe('done');
  });

  it('marks job failed on read error', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b', platformPostId: '1' })
      .returning();
    const [job] = await db
      .insert(metricsJobs)
      .values({ draftId: draft!.id, runAt: new Date() })
      .returning();

    await runOne({ jobId: job!.id, readX: vi.fn().mockRejectedValue(new Error('429')) });

    const [updatedJob] = await db.select().from(metricsJobs).where(eq(metricsJobs.id, job!.id));
    expect(updatedJob!.status).toBe('failed');
    expect(updatedJob!.lastError).toMatch(/429/);
  });
});
```

- [ ] **Step 4: Run, expect failure**

Run: `pnpm install && pnpm --filter @paperclip/metrics-collector test`

- [ ] **Step 5: Implement `workers/metrics-collector/src/runOne.ts`**

```ts
import { db, drafts, metricsJobs, postMetricsSnapshots, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export interface ReadXFn {
  (input: { tweetId: string }): Promise<{ impressions: number; engagement: number; raw: unknown }>;
}

export async function runOne(deps: { jobId: string; readX: ReadXFn }): Promise<void> {
  const [job] = await db
    .update(metricsJobs)
    .set({ status: 'running', attempts: undefined })
    .where(eq(metricsJobs.id, deps.jobId))
    .returning();
  if (!job) return;

  const [draft] = await db.select().from(drafts).where(eq(drafts.id, job.draftId));
  if (!draft || !draft.platformPostId) {
    await db
      .update(metricsJobs)
      .set({ status: 'failed', lastError: 'draft not posted', attempts: job.attempts + 1 })
      .where(eq(metricsJobs.id, deps.jobId));
    return;
  }

  try {
    if (draft.platform !== Platform.X) throw new Error(`unsupported platform: ${draft.platform}`);
    const m = await deps.readX({ tweetId: draft.platformPostId });
    await db.insert(postMetricsSnapshots).values({
      draftId: draft.id,
      impressions: m.impressions,
      engagement: m.engagement,
      raw: m.raw as object,
    });
    await db.update(metricsJobs).set({ status: 'done', attempts: job.attempts + 1 }).where(eq(metricsJobs.id, deps.jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(metricsJobs)
      .set({ status: 'failed', lastError: message, attempts: job.attempts + 1 })
      .where(eq(metricsJobs.id, deps.jobId));
  }
}
```

- [ ] **Step 6: Implement `workers/metrics-collector/src/index.ts`**

```ts
import { db, metricsJobs } from '@paperclip/db';
import { and, eq, lte, asc } from 'drizzle-orm';
import { makeLogger, loadToken } from '@paperclip/shared';
import { readTweetMetrics, type XCreds } from '@paperclip/x-mcp';
import { runOne } from './runOne.js';

const log = makeLogger('metrics-collector');
const ACCOUNT = 'newsletter_main';
const POLL_MS = 30_000;

async function loop() {
  const creds = await loadToken<XCreds>({ account: ACCOUNT, platform: 'x' });
  if (!creds) { log.error('no creds'); return; }

  while (true) {
    const due = await db
      .select()
      .from(metricsJobs)
      .where(and(eq(metricsJobs.status, 'pending'), lte(metricsJobs.runAt, new Date())))
      .orderBy(asc(metricsJobs.runAt))
      .limit(10);

    for (const j of due) {
      await runOne({
        jobId: j.id,
        readX: ({ tweetId }) => readTweetMetrics({ tweetId, creds }),
      }).catch((err: Error) => log.error({ err, jobId: j.id }, 'runOne crashed'));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop().catch((err: Error) => { log.error({ err }, 'metrics-collector died'); process.exit(1); });
log.info('metrics-collector started');
```

- [ ] **Step 7: Run tests + build**

Run: `pnpm --filter @paperclip/metrics-collector test && pnpm --filter @paperclip/metrics-collector build`
Expected: tests PASS, build clean.

- [ ] **Step 8: Commit**

```bash
git add workers/metrics-collector/
git commit -m "feat(metrics-collector): drain metrics_jobs into post_metrics_snapshots"
```

---

### Task 11: Stub-agent CLI — runWeek

**Files:**
- Create: `scripts/stub-agents/package.json`
- Create: `scripts/stub-agents/tsconfig.json`
- Create: `scripts/stub-agents/src/researcher.ts`
- Create: `scripts/stub-agents/src/copywriter.ts`
- Create: `scripts/stub-agents/src/editor.ts`
- Create: `scripts/stub-agents/src/runWeek.ts`

- [ ] **Step 1: Write `scripts/stub-agents/package.json`**

```json
{
  "name": "@paperclip/stub-agents",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "stub:run-week": "tsx src/runWeek.ts"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "@paperclip/drafts-mcp": "workspace:*",
    "@paperclip/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "4.19.2",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: Write `scripts/stub-agents/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Re-export tool functions from `drafts-mcp` as a library**

Add to `mcp/drafts-mcp/package.json`:
```json
"main": "src/index.ts",
```
And create `mcp/drafts-mcp/src/index.ts`:

```ts
export { createDraft } from './tools/createDraft.js';
export { updateDraft } from './tools/updateDraft.js';
export { getDraft } from './tools/getDraft.js';
export { listByStatus } from './tools/listByStatus.js';
export { transitionStatus } from './tools/transitionStatus.js';
```

- [ ] **Step 4: Write `scripts/stub-agents/src/researcher.ts`**

```ts
import { updateDraft, transitionStatus } from '@paperclip/drafts-mcp';
import { DraftStatus } from '@paperclip/db';

const cannedResearch = {
  trends: ['async-first newsletters', 'agentic dev workflows'],
  topPosts: [
    { platform: 'x', text: 'Threads with one strong stat outperform 3:1.' },
    { platform: 'x', text: 'Question openers double reply rate.' },
  ],
  audienceNotes: 'Founders and indie devs reading at 7-9am ET.',
};

export async function research(draftId: string) {
  await updateDraft({ id: draftId, research: cannedResearch });
  return transitionStatus({ draftId, to: DraftStatus.Researched, actor: 'stub:researcher' });
}
```

- [ ] **Step 5: Write `scripts/stub-agents/src/copywriter.ts`**

```ts
import { createDraft, updateDraft, transitionStatus, getDraft } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';

const cannedVariants: Record<Platform, string[]> = {
  [Platform.X]: [
    "what if your newsletter could find subscribers while you sleep? the math: 1 post, 5 platforms, ~8 hours of organic. running this in prod now.",
    "shipped: an AI agency for my newsletter that posts on x + linkedin, attributes signups via utm, and feeds wins back into next week's copy. zero humans (except me, paste-approving). link in reply.",
    "took the 'agent does my marketing' meme literally. 6 weeks in. 3 takeaways:\n\n1) attribution > vanity\n2) hook tagging is the unlock\n3) editors-as-agents catch 4/5 dud drafts",
  ],
  [Platform.LinkedIn]: [
    "I built a marketing agency staffed entirely by AI agents. It runs my newsletter's audience growth on X + LinkedIn, attributes every new subscriber to a specific post, and feeds those learnings back into next week's drafts. Here's what surprised me…",
    "Most 'AI for marketing' tools generate posts. None of them close the loop. So I built one that tags every draft with its hook, snapshots performance over 7 days, and surfaces the top-5 winners back to the drafter. Open-source link in comments.",
    "After 6 weeks of running an AI marketing agency on Paperclip, three patterns: (1) measured posts outperform 'just shipped' posts 4:1, (2) hook taxonomy is the unlock — without it, you're guessing, (3) approval queue UI matters more than the agents.",
  ],
};

const hookTags: string[] = ['question-opener', 'numbered-list', 'behind-the-scenes'];

export async function draft({ briefId, platform }: { briefId: string; platform: Platform }) {
  const brief = await getDraft({ id: briefId });
  if (!brief) throw new Error('brief not found');
  const variants = cannedVariants[platform];
  const created: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = await createDraft({
      platform,
      parentBriefId: briefId,
      status: DraftStatus.Drafted,
      body: variants[i]!,
      hookTag: hookTags[i % hookTags.length],
    });
    created.push(v.id);
  }
  return created;
}

export async function moveToEditorReview(draftId: string) {
  return transitionStatus({ draftId, to: DraftStatus.EditorReview, actor: 'stub:copywriter' });
}
```

- [ ] **Step 6: Write `scripts/stub-agents/src/editor.ts`**

```ts
import { transitionStatus, getDraft } from '@paperclip/drafts-mcp';
import { DraftStatus } from '@paperclip/db';

export async function review(draftId: string) {
  const d = await getDraft({ id: draftId });
  if (!d) throw new Error('not found');
  // Stub policy: reject if empty, approve otherwise.
  if (!d.body.trim()) {
    return transitionStatus({ draftId, to: DraftStatus.ReworkRequested, actor: 'stub:editor', reason: 'empty body' });
  }
  return transitionStatus({ draftId, to: DraftStatus.ApprovalQueue, actor: 'stub:editor', reason: 'looks good' });
}
```

- [ ] **Step 7: Write `scripts/stub-agents/src/runWeek.ts`**

```ts
#!/usr/bin/env node
import { createDraft, transitionStatus, listByStatus } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';
import { research } from './researcher.js';
import { draft as writeVariants, moveToEditorReview } from './copywriter.js';
import { review } from './editor.js';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('stub:runWeek');

async function main() {
  // 1. Strategist: one brief per platform for this "week".
  const briefX = await createDraft({ platform: Platform.X, status: DraftStatus.Briefed, body: 'Theme: building in public the AI marketing agency' });
  const briefLi = await createDraft({ platform: Platform.LinkedIn, status: DraftStatus.Briefed, body: 'Theme: building in public the AI marketing agency' });
  log.info({ briefXId: briefX.id, briefLiId: briefLi.id }, 'briefs created');

  // 2. Researcher fills in research blob.
  await research(briefX.id);
  await research(briefLi.id);

  // 3. Brief moves to drafted state so copywriter can spawn variants.
  await transitionStatus({ draftId: briefX.id, to: DraftStatus.Drafted, actor: 'stub:strategist' });
  await transitionStatus({ draftId: briefLi.id, to: DraftStatus.Drafted, actor: 'stub:strategist' });

  // 4. Copywriter spawns N variants per platform.
  const xVariants = await writeVariants({ briefId: briefX.id, platform: Platform.X });
  const liVariants = await writeVariants({ briefId: briefLi.id, platform: Platform.LinkedIn });
  log.info({ x: xVariants.length, li: liVariants.length }, 'variants created');

  // 5. Each variant -> editor_review -> approval_queue.
  for (const id of [...xVariants, ...liVariants]) {
    await moveToEditorReview(id);
    await review(id);
  }

  // 6. Report.
  const queue = await listByStatus({ status: DraftStatus.ApprovalQueue });
  log.info({ queueDepth: queue.length }, 'done — visit /queue to approve');
}

main().catch((err: Error) => { log.error({ err }, 'runWeek failed'); process.exit(1); });
```

- [ ] **Step 8: Run end-to-end against local DB**

```bash
pnpm db:up && pnpm --filter @paperclip/db migrate
pnpm install
pnpm --filter @paperclip/stub-agents stub:run-week
```
Expected: log shows ~6 queue items (3 X + 3 LinkedIn). Visit `http://localhost:3000/queue` (Plan-1 web shell) — see 6 cards.

- [ ] **Step 9: Commit**

```bash
git add scripts/stub-agents/ mcp/drafts-mcp/src/index.ts mcp/drafts-mcp/package.json pnpm-lock.yaml
git commit -m "feat(stub-agents): add runWeek CLI exercising the full pipeline without LLMs"
```

---

### Task 12: Wire workers + Postgres + (deferred X creds) into docker-compose

**Files:**
- Modify: `infra/docker-compose.yml`
- Create: `infra/Dockerfile.worker`

- [ ] **Step 1: Write `infra/Dockerfile.worker`**

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
ARG TARGET
ENV TARGET=$TARGET
CMD ["sh", "-c", "node workers/$TARGET/dist/index.js"]
```

- [ ] **Step 2: Extend `infra/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: paperclip-postgres
    environment:
      POSTGRES_DB: paperclip
      POSTGRES_USER: paperclip
      POSTGRES_PASSWORD: paperclip_dev
    ports:
      - "5433:5432"
    volumes:
      - paperclip_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperclip -d paperclip"]
      interval: 3s
      timeout: 3s
      retries: 10

  scheduler:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: scheduler }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip

  metrics-collector:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: metrics-collector }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip

volumes:
  paperclip_pgdata:
```

> **Note:** The `profiles: ["full"]` means workers stay off by default — `pnpm db:up` still only starts Postgres. Run `docker compose -f infra/docker-compose.yml --profile full up` to bring everything up.

- [ ] **Step 3: Verify build**

```bash
docker compose -f infra/docker-compose.yml --profile full build
```
Expected: scheduler + metrics-collector images build (no need to actually run them without creds).

- [ ] **Step 4: Commit**

```bash
git add infra/
git commit -m "chore(infra): add scheduler + metrics-collector services to docker-compose"
```

---

### Task 13: One-time helper to seed X creds locally

**Files:**
- Create: `scripts/seed-x-creds.ts`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Write `scripts/seed-x-creds.ts`** *(used once after a `twurl` or manual OAuth dance)*

```ts
#!/usr/bin/env tsx
import { storeToken } from '@paperclip/shared';

const need = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
for (const k of need) {
  if (!process.env[k]) {
    console.error(`missing env: ${k}`);
    process.exit(1);
  }
}

await storeToken({
  account: 'newsletter_main',
  platform: 'x',
  payload: {
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  },
});
console.log('x creds stored for account=newsletter_main');
```

- [ ] **Step 2: Add to root `package.json` scripts**

```json
"scripts": {
  "...": "(unchanged)",
  "seed:x-creds": "tsx scripts/seed-x-creds.ts"
}
```

- [ ] **Step 3: Document seeding**

Append to repo `README.md` (create if missing) under a "Local setup" section:

```markdown
## Local setup

1. `pnpm install`
2. `pnpm db:up && pnpm db:migrate`
3. Generate a 32-byte enc key: `node -e 'console.log("base64:"+require("crypto").randomBytes(32).toString("base64"))'` — paste into `.env` as `TOKEN_ENC_KEY=...`.
4. Get X API keys (Basic tier; OAuth 1.0a user context). Export `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`. Then `pnpm seed:x-creds`.
5. `pnpm --filter @paperclip/stub-agents stub:run-week`
6. `pnpm --filter @paperclip/web dev` — http://localhost:3000/queue
7. Approve in the UI — scheduler will post to X on its next tick.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-x-creds.ts package.json README.md
git commit -m "chore: add seed-x-creds helper + local setup docs"
```

---

### Self-Review

**Spec coverage:**
- x-mcp (postTweet, postThread, readTweetMetrics, searchTopPosts) — Tasks 4-6. ✓
- X read cache for tight Basic-tier read limit — Task 5. ✓
- Encrypted token storage — Tasks 1-2. ✓
- Scheduler posts approved X drafts + enqueues 5 snapshot jobs — Tasks 8-9. ✓
- Metrics-collector drains snapshot jobs — Task 10. ✓
- Stub-agent CLI exercising full briefed→approval_queue pipeline — Task 11. ✓
- Docker-compose update — Task 12. ✓

**Out of scope (later plans):**
- LinkedIn flow — Plan 3.
- Real Paperclip agents — Plan 4.
- Per-agent budgets enforced by Paperclip — Plan 4.
- Eval harness — Plan 5.
- VPS deploy — Plan 6.

**Placeholder scan:** none. `notifyAwaitingPaste` is an explicitly stubbed function with a Plan-3 callout, not a TBD.

**Type consistency:** `XCreds`, `postTweet`, `postThread`, `readTweetMetrics`, `searchTopPosts`, `enqueueSnapshots`, `runOne`, `postReady` consistent. `SNAPSHOT_OFFSETS_MIN` defined once in Task 8 and only consumed there.

**Identified gap:** rate-limit enforcement via `MonthlyBudget` is defined in Task 3 but not wired into any tool yet. **Fix:** add a follow-up note for executor to apply during Task 4 — wrap `postTweet` calls in a singleton `MonthlyBudget({ kind: 'writes', cap: 3000 })` and `readTweetMetrics`/`searchTopPosts` in `MonthlyBudget({ kind: 'reads', cap: 10000 })`. Cap values mirror Basic tier. *(Adding inline:)*

**Wiring fix to apply during Task 4 / Task 5:** Construct module-level singletons in `mcp/x-mcp/src/budgets.ts`:

```ts
import { MonthlyBudget } from './rateLimit.js';
export const writeBudget = new MonthlyBudget({ kind: 'writes', cap: Number(process.env.X_WRITE_CAP ?? 3000) });
export const readBudget = new MonthlyBudget({ kind: 'reads', cap: Number(process.env.X_READ_CAP ?? 10000) });
```

Then call `writeBudget.consume(1)` before the `client.v2.tweet` call in `postTweet.ts` and `readBudget.consume(1)` inside the `cached(...)` fetcher in `readTweetMetrics.ts`/`searchTopPosts.ts`. The executor should add this when implementing those tools and extend the existing test files with one budget-exceeded case each.

---

### What you have after Plan 2

A working X posting pipeline. Run `stub:run-week`, approve in the web shell, the scheduler tick posts to your X dev account, and snapshots roll in over 7 days. Zero LLM calls. ~13 commits, ~2500 LoC.
