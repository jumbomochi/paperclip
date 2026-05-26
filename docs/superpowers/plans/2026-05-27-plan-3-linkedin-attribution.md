# Plan 3 — LinkedIn Manual-Paste + Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the LinkedIn surface and the attribution loop. LinkedIn drafts surface in the queue with a "Copy + open compose" deep-link, you paste manually, you paste the resulting URL back, and the system records it as posted. UTM-tagged links survive the trip: when newsletter signups land, attribution-mcp matches them back to the source post. After this ships, you can run a brief through to LinkedIn manually, see a real subscriber attributed to it, and watch that attribution feed into a leaderboard query.

**Architecture:** A new `linkedin-mcp` (read-only) handles research/search. A new `attribution-mcp` owns (1) URL rewriting that wraps every newsletter link with UTM params before drafts hit the queue, (2) an HTTP webhook endpoint for newsletter signup events, and (3) a daily reconciliation poll. A new `notifier` worker pings you on stale `awaiting_paste` LinkedIn drafts. The web shell grows a "Mark as posted" form for LinkedIn drafts and a leaderboard skeleton.

**Tech Stack:** Plan 1 + Plan 2 stack, plus `hono` (small HTTP framework for attribution-mcp webhook), `linkedin-api-client` (or direct `fetch`), `nodemailer` (optional notifier transport).

**Depends on:** Plans 1 and 2 complete.

---

## File Structure

```
paperclip/
├── mcp/
│   ├── linkedin-mcp/                         # NEW
│   │   ├── package.json                      # @paperclip/linkedin-mcp
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── client.ts
│   │   │   └── tools/
│   │   │       ├── searchTopPosts.ts
│   │   │       └── readPostMetrics.ts         # best-effort, may return null
│   │   └── tests/searchTopPosts.test.ts
│   ├── drafts-mcp/                           # +utm rewrite tool
│   │   └── src/tools/rewriteLinksWithUtm.ts
│   └── attribution-mcp/                      # NEW
│       ├── package.json                      # @paperclip/attribution-mcp
│       ├── tsconfig.json
│       ├── src/
│       │   ├── server.ts                     # HTTP webhook (hono)
│       │   ├── handlers/
│       │   │   ├── webhook.ts                # POST /webhook/newsletter
│       │   │   └── reconcile.ts              # poll newsletter API for misses
│       │   ├── parseUtm.ts
│       │   └── newsletterClients/
│       │       ├── beehiiv.ts                # one concrete client
│       │       └── types.ts
│       └── tests/
│           ├── webhook.test.ts
│           ├── parseUtm.test.ts
│           └── reconcile.test.ts
├── workers/
│   └── notifier/                             # NEW
│       ├── package.json                      # @paperclip/notifier
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── findStale.ts
│       │   └── send.ts                       # console + email transports
│       └── tests/findStale.test.ts
├── apps/web/                                 # additions
│   ├── app/
│   │   ├── queue/                            # extended
│   │   │   └── LinkedInPasteCard.tsx          # NEW client component
│   │   └── api/drafts/[id]/
│   │       └── mark-posted/route.ts          # NEW
│   └── app/leaderboards/page.tsx             # NEW (skeleton)
└── infra/docker-compose.yml                  # +attribution-mcp, +notifier
```

**Key boundaries:**

- `attribution-mcp` is the **only** writer to `attributions`. Web shell does NOT touch it.
- UTM construction lives in **one place** (`drafts-mcp/src/tools/rewriteLinksWithUtm.ts`); both stub-agents (Plan 2) and real agents (Plan 4) call it identically.
- `linkedin-mcp` exports **no write tool**. The web shell, not the MCP, is what bridges the human paste action.

---

### Task 1: UTM link rewriting in `drafts-mcp` (TDD)

**Files:**
- Create: `mcp/drafts-mcp/src/tools/rewriteLinksWithUtm.ts`
- Create: `mcp/drafts-mcp/tests/rewriteLinksWithUtm.test.ts`

- [ ] **Step 1: Failing test**

```ts
// mcp/drafts-mcp/tests/rewriteLinksWithUtm.test.ts
import { describe, it, expect } from 'vitest';
import { rewriteLinksWithUtm } from '../src/tools/rewriteLinksWithUtm.js';

const NEWSLETTER = 'https://news.example.com';

describe('rewriteLinksWithUtm', () => {
  it('adds utm params to a bare newsletter link', () => {
    const out = rewriteLinksWithUtm({
      text: `Read it: ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'post_abc', content: 'question-opener' },
    });
    expect(out).toContain(
      `${NEWSLETTER}/?utm_source=x&utm_medium=social&utm_campaign=post_abc&utm_content=question-opener`,
    );
  });

  it('preserves an existing path and query on the newsletter URL', () => {
    const out = rewriteLinksWithUtm({
      text: `Try ${NEWSLETTER}/issue/42?foo=bar`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'post_xyz' },
    });
    expect(out).toMatch(/\/issue\/42\?foo=bar&utm_source=x&utm_medium=social&utm_campaign=post_xyz/);
  });

  it('does not touch non-newsletter links', () => {
    const out = rewriteLinksWithUtm({
      text: `Comparison: https://other.example.com/x and ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    expect(out).toContain('https://other.example.com/x');
    expect(out).toContain(`${NEWSLETTER}/?utm_source=x`);
  });

  it('is idempotent — does not double-tag a previously rewritten link', () => {
    const first = rewriteLinksWithUtm({
      text: `Read ${NEWSLETTER}`,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    const second = rewriteLinksWithUtm({
      text: first,
      newsletterOrigin: NEWSLETTER,
      utm: { source: 'x', medium: 'social', campaign: 'c1' },
    });
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @paperclip/drafts-mcp test`

- [ ] **Step 3: Implement `mcp/drafts-mcp/src/tools/rewriteLinksWithUtm.ts`**

```ts
export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
}

export interface RewriteInput {
  text: string;
  newsletterOrigin: string;
  utm: UtmParams;
}

const URL_RE = /https?:\/\/[^\s)]+/g;

export function rewriteLinksWithUtm(input: RewriteInput): string {
  const origin = new URL(input.newsletterOrigin).origin;
  return input.text.replace(URL_RE, (match) => {
    let u: URL;
    try { u = new URL(match); } catch { return match; }
    if (u.origin !== origin) return match;
    if (u.searchParams.get('utm_source') === input.utm.source &&
        u.searchParams.get('utm_campaign') === input.utm.campaign) {
      return match; // already tagged, idempotent
    }
    u.searchParams.set('utm_source', input.utm.source);
    u.searchParams.set('utm_medium', input.utm.medium);
    u.searchParams.set('utm_campaign', input.utm.campaign);
    if (input.utm.content) u.searchParams.set('utm_content', input.utm.content);
    return u.toString();
  });
}
```

- [ ] **Step 4: Re-export from `mcp/drafts-mcp/src/index.ts`**

Add: `export { rewriteLinksWithUtm } from './tools/rewriteLinksWithUtm.js';`

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @paperclip/drafts-mcp test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp/drafts-mcp/src/tools/rewriteLinksWithUtm.ts mcp/drafts-mcp/tests/rewriteLinksWithUtm.test.ts mcp/drafts-mcp/src/index.ts
git commit -m "feat(drafts-mcp): add rewriteLinksWithUtm — UTM tagging for newsletter links"
```

---

### Task 2: Wire UTM rewrite into scheduler/post path

**Files:**
- Modify: `workers/scheduler/src/postReady.ts`
- Modify: `workers/scheduler/tests/postReady.test.ts`

- [ ] **Step 1: Extend test to assert UTM tagging**

Add to `workers/scheduler/tests/postReady.test.ts` (inside the existing describe):

```ts
it('rewrites newsletter links with UTM params before posting', async () => {
  process.env.NEWSLETTER_ORIGIN = 'https://news.example.com';
  const [draft] = await db
    .insert(drafts)
    .values({
      platform: Platform.X,
      status: DraftStatus.Approved,
      body: 'Read it: https://news.example.com',
      hookTag: 'question-opener',
      scheduledFor: new Date(Date.now() - 1000),
    })
    .returning();

  const postFn = vi.fn().mockResolvedValue({ id: '1', url: 'https://x.com/i/web/status/1' });
  await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });

  expect(postFn).toHaveBeenCalledOnce();
  const passed = postFn.mock.calls[0]![0] as { text: string };
  expect(passed.text).toContain('utm_source=x');
  expect(passed.text).toContain(`utm_campaign=post_${draft!.id}`);
  expect(passed.text).toContain('utm_content=question-opener');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Modify `workers/scheduler/src/postReady.ts` to rewrite before post**

Inside the `for (const d of due)` loop, before `deps.postX`, replace the existing call with:

```ts
import { rewriteLinksWithUtm } from '@paperclip/drafts-mcp';

// ... inside the loop:
const newsletterOrigin = process.env.NEWSLETTER_ORIGIN;
const text = newsletterOrigin
  ? rewriteLinksWithUtm({
      text: d.body,
      newsletterOrigin,
      utm: {
        source: d.platform === Platform.X ? 'x' : 'linkedin',
        medium: 'social',
        campaign: `post_${d.id}`,
        content: d.hookTag ?? undefined,
      },
    })
  : d.body;
const out = await deps.postX({ account: ACCOUNT, text });
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add workers/scheduler/
git commit -m "feat(scheduler): rewrite newsletter links with UTM params before posting"
```

---

### Task 3: `attribution-mcp` package scaffold + parseUtm (TDD)

**Files:**
- Create: `mcp/attribution-mcp/package.json`
- Create: `mcp/attribution-mcp/tsconfig.json`
- Create: `mcp/attribution-mcp/src/parseUtm.ts`
- Create: `mcp/attribution-mcp/src/newsletterClients/types.ts`
- Create: `mcp/attribution-mcp/tests/parseUtm.test.ts`

- [ ] **Step 1: `mcp/attribution-mcp/package.json`**

```json
{
  "name": "@paperclip/attribution-mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "src/server.ts",
  "bin": { "attribution-mcp": "dist/server.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "@paperclip/shared": "workspace:*",
    "drizzle-orm": "0.36.0",
    "hono": "4.6.5",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `mcp/attribution-mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "compilerOptions": { "outDir": "dist" }
}
```

- [ ] **Step 3: `mcp/attribution-mcp/src/newsletterClients/types.ts`**

```ts
export interface SignupEvent {
  subscriberId: string;
  signedUpAt: Date;
  referrerUrl?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
  };
}

export interface NewsletterClient {
  listRecentSignups(since: Date): Promise<SignupEvent[]>;
}
```

- [ ] **Step 4: Failing test `mcp/attribution-mcp/tests/parseUtm.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseUtmFromUrl, extractCampaignDraftId } from '../src/parseUtm.js';

describe('parseUtmFromUrl', () => {
  it('extracts all utm fields from a referrer', () => {
    const r = parseUtmFromUrl(
      'https://news.example.com/?utm_source=x&utm_medium=social&utm_campaign=post_abc-123&utm_content=question-opener',
    );
    expect(r).toEqual({
      source: 'x',
      medium: 'social',
      campaign: 'post_abc-123',
      content: 'question-opener',
    });
  });

  it('returns empty object when no utm present', () => {
    expect(parseUtmFromUrl('https://news.example.com/')).toEqual({});
  });

  it('extracts draft id from post_<id> campaign', () => {
    expect(extractCampaignDraftId('post_abc-123')).toBe('abc-123');
  });

  it('returns null for non-post campaigns', () => {
    expect(extractCampaignDraftId('newsletter_main')).toBeNull();
  });

  it('handles undefined campaign', () => {
    expect(extractCampaignDraftId(undefined)).toBeNull();
  });
});
```

- [ ] **Step 5: Run, expect fail**

- [ ] **Step 6: Implement `mcp/attribution-mcp/src/parseUtm.ts`**

```ts
export interface UtmFields {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export function parseUtmFromUrl(referrerUrl: string): UtmFields {
  try {
    const u = new URL(referrerUrl);
    const out: UtmFields = {};
    const s = u.searchParams.get('utm_source'); if (s) out.source = s;
    const m = u.searchParams.get('utm_medium'); if (m) out.medium = m;
    const c = u.searchParams.get('utm_campaign'); if (c) out.campaign = c;
    const k = u.searchParams.get('utm_content'); if (k) out.content = k;
    return out;
  } catch {
    return {};
  }
}

export function extractCampaignDraftId(campaign: string | undefined): string | null {
  if (!campaign) return null;
  if (!campaign.startsWith('post_')) return null;
  return campaign.slice('post_'.length);
}
```

- [ ] **Step 7: Run, expect pass**

Run: `pnpm install && pnpm --filter @paperclip/attribution-mcp test`

- [ ] **Step 8: Commit**

```bash
git add mcp/attribution-mcp/ pnpm-lock.yaml
git commit -m "feat(attribution-mcp): scaffold package + parseUtm helpers"
```

---

### Task 4: Webhook handler — writes `attributions` (TDD)

**Files:**
- Create: `mcp/attribution-mcp/src/handlers/webhook.ts`
- Create: `mcp/attribution-mcp/tests/webhook.test.ts`

- [ ] **Step 1: Failing test**

```ts
// mcp/attribution-mcp/tests/webhook.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, attributions, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { handleSignupEvent } from '../src/handlers/webhook.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(drafts);
});

describe('handleSignupEvent', () => {
  it('records attribution when referrer points to a known post', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    const res = await handleSignupEvent({
      subscriberId: 'sub_1',
      signedUpAt: new Date(),
      utm: { source: 'x', medium: 'social', campaign: `post_${d!.id}`, content: 'question-opener' },
    });
    expect(res).toEqual({ attributed: true, draftId: d!.id });

    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subscriberId).toBe('sub_1');
  });

  it('ignores events without utm campaign', async () => {
    const res = await handleSignupEvent({ subscriberId: 'sub_2', signedUpAt: new Date(), utm: {} });
    expect(res).toEqual({ attributed: false, reason: 'no_campaign' });
  });

  it('ignores events whose draft id does not exist', async () => {
    const res = await handleSignupEvent({
      subscriberId: 'sub_3',
      signedUpAt: new Date(),
      utm: { campaign: 'post_00000000-0000-0000-0000-000000000000' },
    });
    expect(res).toEqual({ attributed: false, reason: 'draft_not_found' });
  });

  it('is idempotent on duplicate (draft_id, subscriber_id)', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    const ev = {
      subscriberId: 'sub_dup',
      signedUpAt: new Date(),
      utm: { campaign: `post_${d!.id}` },
    };
    await handleSignupEvent(ev);
    await handleSignupEvent(ev);
    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `mcp/attribution-mcp/src/handlers/webhook.ts`**

```ts
import { db, drafts, attributions } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { extractCampaignDraftId, type UtmFields } from '../parseUtm.js';

export interface SignupEventInput {
  subscriberId: string;
  signedUpAt: Date;
  utm: UtmFields;
  referrerUrl?: string;
}

export type SignupResult =
  | { attributed: true; draftId: string }
  | { attributed: false; reason: 'no_campaign' | 'draft_not_found' };

export async function handleSignupEvent(input: SignupEventInput): Promise<SignupResult> {
  const draftId = extractCampaignDraftId(input.utm.campaign);
  if (!draftId) return { attributed: false, reason: 'no_campaign' };

  const [d] = await db.select().from(drafts).where(eq(drafts.id, draftId));
  if (!d) return { attributed: false, reason: 'draft_not_found' };

  await db
    .insert(attributions)
    .values({
      draftId,
      subscriberId: input.subscriberId,
      signedUpAt: input.signedUpAt,
      utmPayload: input.utm,
    })
    .onConflictDoNothing();
  return { attributed: true, draftId };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add mcp/attribution-mcp/src/handlers/webhook.ts mcp/attribution-mcp/tests/webhook.test.ts
git commit -m "feat(attribution-mcp): add handleSignupEvent — idempotent attribution writer"
```

---

### Task 5: Hono HTTP server for the webhook

**Files:**
- Create: `mcp/attribution-mcp/src/server.ts`

- [ ] **Step 1: Write `mcp/attribution-mcp/src/server.ts`**

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { makeLogger } from '@paperclip/shared';
import { handleSignupEvent } from './handlers/webhook.js';
import { parseUtmFromUrl } from './parseUtm.js';

const log = makeLogger('attribution-mcp');
const app = new Hono();

const beehiivSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string(),
    email: z.string().email().optional(),
    created: z.number(),
    referring_site: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
  }),
});

app.get('/health', (c) => c.json({ ok: true }));

app.post('/webhook/newsletter', async (c) => {
  // Bearer guard
  const expected = process.env.ATTRIBUTION_WEBHOOK_SECRET;
  if (!expected) return c.json({ error: 'webhook secret not configured' }, 500);
  const auth = c.req.header('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = beehiivSchema.safeParse(body);
  if (!parsed.success) {
    log.warn({ body }, 'unrecognized webhook shape');
    return c.json({ error: 'invalid payload' }, 400);
  }

  const d = parsed.data.data;
  if (parsed.data.type !== 'subscription.created') {
    return c.json({ ignored: true, reason: 'not a signup' });
  }

  const utmFromUrl = d.referring_site ? parseUtmFromUrl(d.referring_site) : {};
  const result = await handleSignupEvent({
    subscriberId: d.id,
    signedUpAt: new Date(d.created * 1000),
    utm: {
      source: d.utm_source ?? utmFromUrl.source,
      medium: d.utm_medium ?? utmFromUrl.medium,
      campaign: d.utm_campaign ?? utmFromUrl.campaign,
      content: d.utm_content ?? utmFromUrl.content,
    },
    referrerUrl: d.referring_site,
  });
  log.info({ result, subscriberId: d.id }, 'signup handled');
  return c.json(result);
});

const port = Number(process.env.ATTRIBUTION_PORT ?? 4001);
serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port }, 'attribution-mcp listening');
});
```

- [ ] **Step 2: Add `@hono/node-server` dependency**

Modify `mcp/attribution-mcp/package.json` dependencies:
```json
"@hono/node-server": "1.13.4",
```

- [ ] **Step 3: Build & smoke**

```bash
pnpm install
pnpm --filter @paperclip/attribution-mcp build
ATTRIBUTION_WEBHOOK_SECRET=devsecret \
  ATTRIBUTION_PORT=4001 \
  node mcp/attribution-mcp/dist/server.js &
sleep 1
curl -s http://localhost:4001/health
kill %1
```
Expected: `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add mcp/attribution-mcp/src/server.ts mcp/attribution-mcp/package.json pnpm-lock.yaml
git commit -m "feat(attribution-mcp): add hono webhook server"
```

---

### Task 6: Beehiiv reconciliation client (TDD)

**Files:**
- Create: `mcp/attribution-mcp/src/newsletterClients/beehiiv.ts`
- Create: `mcp/attribution-mcp/src/handlers/reconcile.ts`
- Create: `mcp/attribution-mcp/tests/reconcile.test.ts`

> **Note:** Beehiiv is the assumed initial newsletter platform. If you choose another (Substack, Kit, Ghost), adapt this task — same interface, different `listRecentSignups` implementation.

- [ ] **Step 1: Failing test `mcp/attribution-mcp/tests/reconcile.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, attributions, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { reconcile } from '../src/handlers/reconcile.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(drafts);
});

describe('reconcile', () => {
  it('writes attributions for signups missed by the webhook', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();

    const fakeClient = {
      listRecentSignups: vi.fn().mockResolvedValue([
        { subscriberId: 's1', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
        { subscriberId: 's2', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
        { subscriberId: 's3', signedUpAt: new Date(), utm: {} }, // unattributable
      ]),
    };

    const summary = await reconcile({ client: fakeClient, since: new Date(0) });
    expect(summary.attributed).toBe(2);
    expect(summary.ignored).toBe(1);

    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(2);
  });

  it('does not double-write signups already attributed', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    await db.insert(attributions).values({
      draftId: d!.id, subscriberId: 's1', signedUpAt: new Date(), utmPayload: { campaign: `post_${d!.id}` },
    });

    const fakeClient = {
      listRecentSignups: vi.fn().mockResolvedValue([
        { subscriberId: 's1', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
      ]),
    };
    const summary = await reconcile({ client: fakeClient, since: new Date(0) });
    expect(summary.attributed).toBe(1); // counted as attributed; insert is no-op
    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `mcp/attribution-mcp/src/handlers/reconcile.ts`**

```ts
import type { NewsletterClient } from '../newsletterClients/types.js';
import { handleSignupEvent } from './webhook.js';

export interface ReconcileSummary {
  total: number;
  attributed: number;
  ignored: number;
}

export async function reconcile(deps: { client: NewsletterClient; since: Date }): Promise<ReconcileSummary> {
  const events = await deps.client.listRecentSignups(deps.since);
  const out: ReconcileSummary = { total: events.length, attributed: 0, ignored: 0 };
  for (const e of events) {
    const r = await handleSignupEvent({
      subscriberId: e.subscriberId,
      signedUpAt: e.signedUpAt,
      utm: e.utm ?? {},
      referrerUrl: e.referrerUrl,
    });
    if (r.attributed) out.attributed++;
    else out.ignored++;
  }
  return out;
}
```

- [ ] **Step 3: Implement `mcp/attribution-mcp/src/newsletterClients/beehiiv.ts`**

```ts
import type { NewsletterClient, SignupEvent } from './types.js';

interface BeehiivSubscription {
  id: string;
  created: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referring_site?: string;
}

interface BeehiivListResponse { data: BeehiivSubscription[] }

export interface BeehiivConfig {
  apiKey: string;
  publicationId: string;
  baseUrl?: string;
}

export class BeehiivClient implements NewsletterClient {
  constructor(private readonly cfg: BeehiivConfig) {}

  async listRecentSignups(since: Date): Promise<SignupEvent[]> {
    const base = this.cfg.baseUrl ?? 'https://api.beehiiv.com/v2';
    const url = `${base}/publications/${this.cfg.publicationId}/subscriptions?status=active&created_after=${Math.floor(since.getTime() / 1000)}&limit=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
    if (!res.ok) throw new Error(`beehiiv ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as BeehiivListResponse;
    return body.data.map((s) => ({
      subscriberId: s.id,
      signedUpAt: new Date(s.created * 1000),
      utm: {
        source: s.utm_source,
        medium: s.utm_medium,
        campaign: s.utm_campaign,
        content: s.utm_content,
      },
      referrerUrl: s.referring_site,
    }));
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @paperclip/attribution-mcp test`

- [ ] **Step 5: Add a daily reconcile cron to attribution-mcp server**

Modify `mcp/attribution-mcp/src/server.ts` — append before `serve(...)`:

```ts
import cron from 'node-cron';
import { BeehiivClient } from './newsletterClients/beehiiv.js';
import { reconcile } from './handlers/reconcile.js';

if (process.env.BEEHIIV_API_KEY && process.env.BEEHIIV_PUBLICATION_ID) {
  const client = new BeehiivClient({
    apiKey: process.env.BEEHIIV_API_KEY,
    publicationId: process.env.BEEHIIV_PUBLICATION_ID,
  });
  cron.schedule('17 3 * * *', async () => {
    const since = new Date(Date.now() - 36 * 3600_000); // 36h overlap
    try {
      const r = await reconcile({ client, since });
      log.info(r, 'daily reconcile');
    } catch (err) {
      log.error({ err }, 'reconcile failed');
    }
  });
  log.info('beehiiv reconcile cron registered (03:17 UTC daily)');
}
```

Add `"node-cron": "3.0.3"` and `"@types/node-cron": "3.0.11"` to `mcp/attribution-mcp/package.json`.

- [ ] **Step 6: Commit**

```bash
git add mcp/attribution-mcp/
git commit -m "feat(attribution-mcp): add beehiiv client + daily reconcile cron"
```

---

### Task 7: `linkedin-mcp` package (read-only, TDD with fetch mock)

**Files:**
- Create: `mcp/linkedin-mcp/package.json`
- Create: `mcp/linkedin-mcp/tsconfig.json`
- Create: `mcp/linkedin-mcp/src/client.ts`
- Create: `mcp/linkedin-mcp/src/tools/searchTopPosts.ts`
- Create: `mcp/linkedin-mcp/src/server.ts`
- Create: `mcp/linkedin-mcp/tests/searchTopPosts.test.ts`

> **Important:** LinkedIn's API surface for non-partner apps is severely limited. The `searchTopPosts` tool is best-effort: if the configured scope doesn't allow content search, the tool returns an empty list and logs a warning. Real agents should treat missing LinkedIn research as graceful degradation, not failure.

- [ ] **Step 1: `mcp/linkedin-mcp/package.json`**

```json
{
  "name": "@paperclip/linkedin-mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "src/server.ts",
  "bin": { "linkedin-mcp": "dist/server.js" },
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
    "zod": "3.23.8"
  },
  "devDependencies": {
    "msw": "2.4.9",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `mcp/linkedin-mcp/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "tests/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Failing test `mcp/linkedin-mcp/tests/searchTopPosts.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { searchTopPosts } from '../src/tools/searchTopPosts.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('searchTopPosts', () => {
  it('returns empty list on 403 (scope unavailable)', async () => {
    server.use(
      http.get('https://api.linkedin.com/v2/socialActions', () =>
        HttpResponse.json({ message: 'forbidden' }, { status: 403 }),
      ),
    );
    const r = await searchTopPosts({ query: 'agentic', accessToken: 'x' });
    expect(r).toEqual([]);
  });

  it('returns normalized posts when API responds 200', async () => {
    server.use(
      http.get('https://api.linkedin.com/v2/socialActions', () =>
        HttpResponse.json({
          elements: [
            { id: 'urn:li:share:1', commentary: 'cool post', reactionsSummary: { totalReactions: 100 } },
          ],
        }),
      ),
    );
    const r = await searchTopPosts({ query: 'agentic', accessToken: 'x' });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('urn:li:share:1');
  });
});
```

- [ ] **Step 4: Implement `mcp/linkedin-mcp/src/client.ts`**

```ts
export interface LinkedInClient {
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export function makeClient(accessToken: string): LinkedInClient {
  const base = 'https://api.linkedin.com/v2';
  return {
    async fetchJson(path, init) {
      const r = await fetch(base + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          ...(init?.headers ?? {}),
        },
      });
      if (!r.ok) {
        const err = new Error(`linkedin ${r.status}: ${await r.text()}`);
        (err as Error & { status?: number }).status = r.status;
        throw err;
      }
      return r.json();
    },
  };
}
```

- [ ] **Step 5: Implement `mcp/linkedin-mcp/src/tools/searchTopPosts.ts`**

```ts
import { makeClient } from '../client.js';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('linkedin-mcp.searchTopPosts');

export interface SearchTopPostsInput {
  query: string;
  accessToken: string;
}

export interface NormalizedPost {
  id: string;
  text: string;
  reactions: number;
}

interface LinkedInSocialActionsResponse {
  elements?: Array<{
    id: string;
    commentary?: string;
    reactionsSummary?: { totalReactions?: number };
  }>;
}

export async function searchTopPosts(input: SearchTopPostsInput): Promise<NormalizedPost[]> {
  const c = makeClient(input.accessToken);
  try {
    // socialActions search is restricted to many apps; we attempt and gracefully degrade.
    const body = (await c.fetchJson(
      `/socialActions?q=search&query=${encodeURIComponent(input.query)}&count=20`,
    )) as LinkedInSocialActionsResponse;
    return (body.elements ?? []).map((e) => ({
      id: e.id,
      text: e.commentary ?? '',
      reactions: e.reactionsSummary?.totalReactions ?? 0,
    }));
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 403 || status === 401) {
      log.warn({ status }, 'linkedin search scope unavailable; returning empty list');
      return [];
    }
    throw err;
  }
}
```

- [ ] **Step 6: Run, expect pass**

Run: `pnpm install && pnpm --filter @paperclip/linkedin-mcp test`

- [ ] **Step 7: Implement `mcp/linkedin-mcp/src/server.ts`** (minimal MCP stdio entrypoint with one tool)

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadToken } from '@paperclip/shared';
import { searchTopPosts } from './tools/searchTopPosts.js';

const schema = z.object({ account: z.string(), query: z.string() });
const server = new Server({ name: 'linkedin-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'searchTopPosts', description: 'Search top LinkedIn posts (read-only, may return empty)', inputSchema: { type: 'object' } }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'searchTopPosts') {
    return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
  }
  const v = schema.parse(req.params.arguments);
  const token = await loadToken<{ accessToken: string }>({ account: v.account, platform: 'linkedin' });
  if (!token) return { content: [{ type: 'text', text: 'no linkedin token' }], isError: true };
  const out = await searchTopPosts({ query: v.query, accessToken: token.accessToken });
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 8: Commit**

```bash
git add mcp/linkedin-mcp/ pnpm-lock.yaml
git commit -m "feat(linkedin-mcp): read-only searchTopPosts with graceful degradation on scope-deny"
```

---

### Task 8: Scheduler — route LinkedIn `approved` drafts to `awaiting_paste`

**Files:**
- Modify: `workers/scheduler/src/postReady.ts`
- Modify: `workers/scheduler/tests/postReady.test.ts`

- [ ] **Step 1: Extend test**

Append to `workers/scheduler/tests/postReady.test.ts`:

```ts
it('routes approved LinkedIn drafts to awaiting_paste (no API write call)', async () => {
  const [d] = await db
    .insert(drafts)
    .values({
      platform: Platform.LinkedIn,
      status: DraftStatus.Approved,
      body: 'hello LI',
      scheduledFor: new Date(Date.now() - 1000),
    })
    .returning();
  const postFn = vi.fn();
  await postReady({ now: new Date(), platforms: [Platform.X, Platform.LinkedIn], postX: postFn });

  expect(postFn).not.toHaveBeenCalled();
  const [after] = await db.select().from(drafts).where(eq(drafts.id, d!.id));
  expect(after!.status).toBe(DraftStatus.AwaitingPaste);
});
```

- [ ] **Step 2: Modify `workers/scheduler/src/postReady.ts`**

Inside the `for (const d of due)` loop, before the existing `if (d.platform !== Platform.X) continue;`, replace that line with:

```ts
if (d.platform === Platform.LinkedIn) {
  await db.transaction(async (tx) => {
    await tx.update(drafts).set({ status: DraftStatus.AwaitingPaste, updatedAt: new Date() }).where(eq(drafts.id, d.id));
    await tx.insert(draftTransitions).values({
      draftId: d.id, fromStatus: DraftStatus.Approved, toStatus: DraftStatus.AwaitingPaste, actor: 'scheduler',
    });
  });
  continue;
}
if (d.platform !== Platform.X) continue;
```

- [ ] **Step 3: Run, expect pass**

Run: `pnpm --filter @paperclip/scheduler test`

- [ ] **Step 4: Commit**

```bash
git add workers/scheduler/
git commit -m "feat(scheduler): route LinkedIn approved drafts to awaiting_paste"
```

---

### Task 9: Web shell — LinkedIn paste card + mark-posted route

**Files:**
- Create: `apps/web/app/queue/LinkedInPasteCard.tsx`
- Create: `apps/web/app/api/drafts/[id]/mark-posted/route.ts`
- Modify: `apps/web/app/queue/page.tsx`

- [ ] **Step 1: Write `apps/web/app/api/drafts/[id]/mark-posted/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, drafts, draftTransitions, metricsJobs, DraftStatus, canTransition, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';

const schema = z.object({ url: z.string().url() });
const SNAPSHOT_OFFSETS_MIN = [60, 6 * 60, 24 * 60, 72 * 60, 7 * 24 * 60];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const result = await db.transaction(async (tx) => {
    const [d] = await tx.select().from(drafts).where(eq(drafts.id, id));
    if (!d) return { error: 'not_found' as const };
    if (d.platform !== Platform.LinkedIn) return { error: 'not_linkedin' as const };
    if (!canTransition(d.status as DraftStatus, DraftStatus.Posted)) {
      return { error: `invalid_transition:${d.status}` as const };
    }
    const postedAt = new Date();
    const [updated] = await tx
      .update(drafts)
      .set({
        status: DraftStatus.Posted,
        platformPostUrl: parsed.data.url,
        postedAt,
        updatedAt: postedAt,
      })
      .where(eq(drafts.id, id))
      .returning();
    await tx.insert(draftTransitions).values({
      draftId: id, fromStatus: d.status, toStatus: DraftStatus.Posted, actor: 'human:web',
    });
    await tx.insert(metricsJobs).values(
      SNAPSHOT_OFFSETS_MIN.map((m) => ({
        draftId: id, runAt: new Date(postedAt.getTime() + m * 60_000),
      })),
    );
    return { ok: true as const, draft: updated };
  });

  if ('error' in result) {
    return NextResponse.json(result, { status: result.error === 'not_found' ? 404 : 409 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Write `apps/web/app/queue/LinkedInPasteCard.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Draft {
  id: string;
  platform: string;
  body: string;
  hookTag: string | null;
  status: string;
}

export function LinkedInPasteCard({ draft }: { draft: Draft }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function copyAndOpen() {
    void navigator.clipboard.writeText(draft.body);
    const compose = `https://www.linkedin.com/feed/?shareActive=true`;
    window.open(compose, '_blank', 'noopener,noreferrer');
  }

  function markPosted() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/drafts/${draft.id}/mark-posted`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error?.toString() ?? 'unknown');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-400 dark:border-amber-600 p-4 space-y-3 bg-amber-50/40 dark:bg-amber-950/20">
      <div className="flex justify-between text-xs text-zinc-500">
        <span className="uppercase">LINKEDIN · awaiting paste</span>
        <span>{draft.hookTag ?? 'no hook tag'}</span>
      </div>
      <pre className="whitespace-pre-wrap text-sm font-sans">{draft.body}</pre>
      <button
        onClick={copyAndOpen}
        className="rounded bg-sky-700 px-3 py-1 text-sm text-white"
      >
        Copy + open LinkedIn compose
      </button>
      <div className="space-y-2">
        <label className="block text-xs text-zinc-500">After posting, paste the LinkedIn post URL:</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/posts/..."
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-1 text-sm"
        />
        <button
          onClick={markPosted}
          disabled={pending || !url}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Mark as posted
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `apps/web/app/queue/page.tsx` to include awaiting_paste drafts**

```tsx
import { db, drafts, DraftStatus } from '@paperclip/db';
import { inArray, desc } from 'drizzle-orm';
import { DraftCard } from './DraftCard.js';
import { LinkedInPasteCard } from './LinkedInPasteCard.js';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const rows = await db
    .select()
    .from(drafts)
    .where(inArray(drafts.status, [DraftStatus.ApprovalQueue, DraftStatus.AwaitingPaste]))
    .orderBy(desc(drafts.updatedAt))
    .limit(50);

  const pending = rows.filter((r) => r.status === DraftStatus.ApprovalQueue);
  const awaiting = rows.filter((r) => r.status === DraftStatus.AwaitingPaste);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Queue</h1>
      {awaiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-amber-700 dark:text-amber-300">
            LinkedIn — {awaiting.length} awaiting your paste
          </h2>
          {awaiting.map((d) => (
            <LinkedInPasteCard
              key={d.id}
              draft={{ id: d.id, platform: d.platform, body: d.body, hookTag: d.hookTag, status: d.status }}
            />
          ))}
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Approval queue — {pending.length}</h2>
        {pending.length === 0 && (
          <p className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-zinc-500">Nothing waiting.</p>
        )}
        {pending.map((d) => (
          <DraftCard
            key={d.id}
            draft={{ id: d.id, platform: d.platform, body: d.body, hookTag: d.hookTag, createdAt: d.createdAt }}
          />
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Smoke-test manually**

```bash
pnpm db:up && pnpm --filter @paperclip/db migrate
pnpm --filter @paperclip/stub-agents stub:run-week
pnpm --filter @paperclip/web dev
# Visit /queue, approve a LinkedIn draft -> appears in awaiting-paste section
# Click "Copy + open compose" -> LinkedIn opens in new tab, body copied
# Paste a fake URL like https://www.linkedin.com/posts/jdoh_test-abc
# Click "Mark as posted" -> card disappears
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/queue apps/web/app/api/drafts/
git commit -m "feat(web): LinkedIn paste card + mark-posted route"
```

---

### Task 10: Notifier worker — pings on stale `awaiting_paste` (TDD)

**Files:**
- Create: `workers/notifier/package.json`
- Create: `workers/notifier/tsconfig.json`
- Create: `workers/notifier/src/findStale.ts`
- Create: `workers/notifier/src/send.ts`
- Create: `workers/notifier/src/index.ts`
- Create: `workers/notifier/tests/findStale.test.ts`

- [ ] **Step 1: `workers/notifier/package.json`**

```json
{
  "name": "@paperclip/notifier",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "bin": { "notifier": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@paperclip/db": "workspace:*",
    "@paperclip/shared": "workspace:*",
    "drizzle-orm": "0.36.0",
    "node-cron": "3.0.3",
    "nodemailer": "6.9.16"
  },
  "devDependencies": {
    "@types/node-cron": "3.0.11",
    "@types/nodemailer": "6.4.16",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `workers/notifier/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "tests/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Failing test**

```ts
// workers/notifier/tests/findStale.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, DraftStatus, Platform } from '@paperclip/db';
import { findStaleAwaitingPaste } from '../src/findStale.js';

beforeEach(async () => {
  await db.delete(drafts);
});

describe('findStaleAwaitingPaste', () => {
  it('returns drafts older than threshold', async () => {
    const old = new Date(Date.now() - 90 * 60_000); // 90 min ago
    const fresh = new Date(Date.now() - 5 * 60_000);

    await db.insert(drafts).values([
      { platform: Platform.LinkedIn, status: DraftStatus.AwaitingPaste, body: 'old', updatedAt: old },
      { platform: Platform.LinkedIn, status: DraftStatus.AwaitingPaste, body: 'fresh', updatedAt: fresh },
      { platform: Platform.LinkedIn, status: DraftStatus.Posted, body: 'done', updatedAt: old },
    ]);

    const stale = await findStaleAwaitingPaste({ thresholdMinutes: 60 });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.body).toBe('old');
  });
});
```

- [ ] **Step 4: Implement `workers/notifier/src/findStale.ts`**

```ts
import { db, drafts, DraftStatus } from '@paperclip/db';
import { and, eq, lt } from 'drizzle-orm';

export async function findStaleAwaitingPaste(input: { thresholdMinutes: number }) {
  const cutoff = new Date(Date.now() - input.thresholdMinutes * 60_000);
  return db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, DraftStatus.AwaitingPaste), lt(drafts.updatedAt, cutoff)));
}
```

- [ ] **Step 5: Implement `workers/notifier/src/send.ts`**

```ts
import nodemailer from 'nodemailer';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('notifier.send');

export interface Notification {
  subject: string;
  body: string;
}

export async function send(n: Notification): Promise<void> {
  const transportMode = process.env.NOTIFIER_TRANSPORT ?? 'console';
  if (transportMode === 'console') {
    log.info({ subject: n.subject, body: n.body }, 'NOTIFY');
    return;
  }
  if (transportMode === 'email') {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });
    await t.sendMail({
      from: process.env.NOTIFY_FROM ?? 'paperclip@localhost',
      to: process.env.NOTIFY_TO!,
      subject: n.subject,
      text: n.body,
    });
    log.info({ subject: n.subject }, 'email sent');
    return;
  }
  throw new Error(`unknown NOTIFIER_TRANSPORT: ${transportMode}`);
}
```

- [ ] **Step 6: Implement `workers/notifier/src/index.ts`**

```ts
import cron from 'node-cron';
import { makeLogger } from '@paperclip/shared';
import { findStaleAwaitingPaste } from './findStale.js';
import { send } from './send.js';

const log = makeLogger('notifier');
const THRESHOLD_MIN = Number(process.env.NOTIFIER_STALE_MIN ?? 60);
const URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

async function tick() {
  const stale = await findStaleAwaitingPaste({ thresholdMinutes: THRESHOLD_MIN });
  if (stale.length === 0) return;
  await send({
    subject: `${stale.length} LinkedIn draft(s) awaiting your paste`,
    body:
      `The following drafts have been sitting in awaiting_paste for > ${THRESHOLD_MIN} minutes:\n\n` +
      stale.map((d) => `- ${d.id}: ${d.body.slice(0, 80)}…`).join('\n') +
      `\n\nReview at ${URL}/queue`,
  });
}

cron.schedule('*/15 * * * *', () => {
  tick().catch((err: Error) => log.error({ err }, 'notifier tick error'));
});
log.info({ thresholdMinutes: THRESHOLD_MIN }, 'notifier started');
tick().catch((err: Error) => log.error({ err }, 'startup tick error'));
```

- [ ] **Step 7: Run, expect pass**

Run: `pnpm install && pnpm --filter @paperclip/notifier test`

- [ ] **Step 8: Commit**

```bash
git add workers/notifier/ pnpm-lock.yaml
git commit -m "feat(notifier): ping on awaiting_paste drafts older than threshold"
```

---

### Task 11: Leaderboards skeleton page (uses attributions)

**Files:**
- Create: `apps/web/app/leaderboards/page.tsx`

- [ ] **Step 1: Write `apps/web/app/leaderboards/page.tsx`**

```tsx
import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface HookRow { hookTag: string | null; signups: number; impressions: number }

export default async function LeaderboardsPage() {
  const hookRows = (await db.execute(sql`
    SELECT d.hook_tag AS "hookTag",
           COUNT(DISTINCT a.subscriber_id)::int AS signups,
           COALESCE(SUM(s.impressions), 0)::int AS impressions
    FROM drafts d
    LEFT JOIN attributions a ON a.draft_id = d.id
    LEFT JOIN post_metrics_snapshots s ON s.draft_id = d.id
    WHERE d.status IN ('posted', 'measuring', 'archived')
    GROUP BY d.hook_tag
    ORDER BY signups DESC NULLS LAST
    LIMIT 25
  `)) as unknown as { rows: HookRow[] };

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Hook leaderboard</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-300 dark:border-zinc-700 text-xs uppercase text-zinc-500">
            <th className="py-2 text-left">Hook tag</th>
            <th className="py-2 text-right">Signups</th>
            <th className="py-2 text-right">Impressions</th>
            <th className="py-2 text-right">Signups/1k imp.</th>
          </tr>
        </thead>
        <tbody>
          {hookRows.rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-2">{r.hookTag ?? '(none)'}</td>
              <td className="py-2 text-right tabular-nums">{r.signups}</td>
              <td className="py-2 text-right tabular-nums">{r.impressions}</td>
              <td className="py-2 text-right tabular-nums">
                {r.impressions > 0 ? ((r.signups / r.impressions) * 1000).toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Smoke**

Visit `/leaderboards` — should render an empty (or near-empty) table cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/leaderboards/
git commit -m "feat(web): hook leaderboard page driven by attributions + snapshots"
```

---

### Task 12: docker-compose additions for attribution-mcp + notifier

**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `infra/Dockerfile.worker`

- [ ] **Step 1: Extend `infra/Dockerfile.worker` to handle MCP server target**

Replace the `CMD` line with:

```dockerfile
ARG TARGET
ARG KIND=worker
ENV TARGET=$TARGET
ENV KIND=$KIND
CMD ["sh", "-c", "node ${KIND}/${TARGET}/dist/${KIND == 'mcp' ? 'server' : 'index'}.js"]
```

Since shell `${var == ...}` isn't portable, use entry script instead. Replace the `CMD` line with:

```dockerfile
COPY infra/entry.sh /entry.sh
RUN chmod +x /entry.sh
CMD ["/entry.sh"]
```

And create `infra/entry.sh`:

```sh
#!/bin/sh
set -eu
case "$KIND" in
  worker) exec node "workers/$TARGET/dist/index.js" ;;
  mcp) exec node "mcp/$TARGET/dist/server.js" ;;
  *) echo "unknown KIND=$KIND"; exit 1 ;;
esac
```

- [ ] **Step 2: Append services to `infra/docker-compose.yml`**

```yaml
  attribution-mcp:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: attribution-mcp, KIND: mcp }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip
      ATTRIBUTION_PORT: 4001
    ports:
      - "4001:4001"

  notifier:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: notifier, KIND: worker }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip
      NOTIFIER_TRANSPORT: console
      WEB_BASE_URL: http://localhost:3000
```

- [ ] **Step 3: Build**

Run: `docker compose -f infra/docker-compose.yml --profile full build`
Expected: all images build cleanly.

- [ ] **Step 4: Commit**

```bash
git add infra/
git commit -m "chore(infra): add attribution-mcp + notifier to docker-compose"
```

---

### Task 13: Documentation — Beehiiv webhook setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append Beehiiv setup section to `README.md`**

```markdown
## Newsletter (Beehiiv) setup

1. In Beehiiv → Settings → Integrations → Webhooks: add `https://<your-host>/webhook/newsletter` with event `subscription.created`.
2. Generate a strong secret; set `ATTRIBUTION_WEBHOOK_SECRET` env var on attribution-mcp.
3. Configure Beehiiv to send the secret as `Authorization: Bearer <secret>` (Beehiiv supports custom headers per webhook).
4. (Optional) Generate a Beehiiv API key with `subscriptions.read`; set `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` to enable the daily reconciliation job.

If you use a different newsletter platform: implement the `NewsletterClient` interface (`mcp/attribution-mcp/src/newsletterClients/types.ts`) and replace the import in `server.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document beehiiv webhook setup for attribution"
```

---

### Self-Review

**Spec coverage:**
- linkedin-mcp (read-only) — Task 7. ✓
- UTM rewriting at post-time — Tasks 1-2. ✓
- attribution-mcp webhook (handleSignupEvent) — Tasks 3-5. ✓
- Daily reconciliation — Task 6. ✓
- LinkedIn manual paste flow (`awaiting_paste` → paste-back → posted) — Tasks 8-9. ✓
- Notifier for stale awaiting_paste drafts — Task 10. ✓
- Leaderboard skeleton using attributions — Task 11. ✓
- docker-compose update — Task 12. ✓

**Placeholder scan:** none.

**Type consistency:** `UtmFields`, `extractCampaignDraftId`, `handleSignupEvent`, `NewsletterClient`, `BeehiivClient`, `findStaleAwaitingPaste`, `SNAPSHOT_OFFSETS_MIN` consistent.

**Identified gap:** `SNAPSHOT_OFFSETS_MIN` is now defined in BOTH `workers/scheduler/src/enqueueSnapshots.ts` and `apps/web/app/api/drafts/[id]/mark-posted/route.ts`. **Fix:** the executor should extract this constant into `@paperclip/db` (or `@paperclip/shared`) and import from both places during Task 9. Add this as a small DRY pass: create `packages/shared/src/metrics.ts` exporting `SNAPSHOT_OFFSETS_MIN`, update both call sites to import from there, run all tests.

---

### What you have after Plan 3

A full content loop: stub-agents draft → you approve → X posts auto, LinkedIn paste manually → snapshots collect for X, mark-posted enqueues snapshots for LinkedIn → newsletter webhook attributes signups → leaderboard ranks hooks by signups. Still no LLMs. ~13 commits, ~2200 LoC.
