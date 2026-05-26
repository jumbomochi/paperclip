# Plan 5 — Evals + Analyst Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two remaining feedback loops. (1) An eval harness that gates every Copywriter/Editor prompt change in CI — golden inputs, rubric-driven judging by a different model. (2) An analytics-mcp + Analyst loop that surfaces top-performing hooks and themes back into the Copywriters' drafting context as few-shot examples, and into your dashboard as digests + leaderboards. After this ships, you can't ship a regressing prompt without CI catching it, and the Copywriters learn from prior winners every week.

**Architecture:** A new `analytics-mcp` package owns aggregated queries — joins of `drafts`, `post_metrics_snapshots`, `attributions` — and a single `writeDigest` mutation that the Analyst calls. `promptfoo` runs in a new `evals/` directory at the repo root; each agent has its own eval set plus a shared judge prompt. The web shell grows two pages: `/digests` (Analyst's outputs) and per-post drilldowns become richer.

**Tech Stack:** Plans 1-4 stack, plus `promptfoo`, `@anthropic-ai/sdk` (the eval harness calls the API directly), `recharts` (snapshot timeline chart).

**Depends on:** Plans 1-4 complete.

---

## File Structure

```
paperclip/
├── mcp/
│   └── analytics-mcp/                        # NEW
│       ├── package.json                      # @paperclip/analytics-mcp
│       ├── tsconfig.json
│       ├── src/
│       │   ├── server.ts
│       │   ├── queries/
│       │   │   ├── postsLastNDays.ts
│       │   │   ├── topHooksLastNDays.ts
│       │   │   ├── topThemesLastNDays.ts
│       │   │   ├── topWinnersByPlatform.ts
│       │   │   ├── attributionsLastNDays.ts
│       │   │   └── getLastDigest.ts
│       │   └── tools/
│       │       └── writeDigest.ts
│       └── tests/
│           ├── topHooksLastNDays.test.ts
│           ├── topWinnersByPlatform.test.ts
│           └── writeDigest.test.ts
├── evals/                                    # NEW: promptfoo configs
│   ├── README.md
│   ├── promptfooconfig.base.yaml
│   ├── shared/
│   │   ├── judge.yaml                        # judge model + rubric
│   │   └── fixtures/
│   │       └── voice.md                      # symlinks/copies of brand_voice
│   ├── copywriter_x/
│   │   ├── promptfooconfig.yaml
│   │   └── cases/                            # 20 canned brief+research inputs
│   │       ├── 001-launch-announce.yaml
│   │       ├── 002-counterintuitive.yaml
│   │       └── ... (18 more)
│   ├── copywriter_linkedin/
│   │   ├── promptfooconfig.yaml
│   │   └── cases/
│   │       └── ...
│   └── editor/
│       ├── promptfooconfig.yaml
│       └── cases/
│           └── ... (10 cases: good + 10 bad)
├── .github/
│   └── workflows/
│       └── evals.yml                         # NEW: CI gate
└── apps/web/
    ├── app/
    │   ├── digests/
    │   │   ├── page.tsx                      # NEW: list of digests
    │   │   └── [id]/page.tsx                 # NEW: one digest detail
    │   └── posts/[id]/
    │       └── SnapshotChart.tsx             # NEW: recharts timeline
    └── package.json                          # +recharts
```

---

### Task 1: `analytics-mcp` scaffold + `topHooksLastNDays` (TDD)

**Files:**
- Create: `mcp/analytics-mcp/package.json`
- Create: `mcp/analytics-mcp/tsconfig.json`
- Create: `mcp/analytics-mcp/src/queries/topHooksLastNDays.ts`
- Create: `mcp/analytics-mcp/tests/topHooksLastNDays.test.ts`

- [ ] **Step 1: `mcp/analytics-mcp/package.json`**

```json
{
  "name": "@paperclip/analytics-mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "src/server.ts",
  "bin": { "analytics-mcp": "dist/server.js" },
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
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `mcp/analytics-mcp/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "tests/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Failing test `mcp/analytics-mcp/tests/topHooksLastNDays.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, postMetricsSnapshots, attributions, DraftStatus, Platform } from '@paperclip/db';
import { topHooksLastNDays } from '../src/queries/topHooksLastNDays.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(postMetricsSnapshots);
  await db.delete(drafts);
});

describe('topHooksLastNDays', () => {
  it('ranks hooks by signups per 1k impressions, returning top N', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000);
    const [a, b] = await db
      .insert(drafts)
      .values([
        { platform: Platform.X, status: DraftStatus.Posted, body: 'a', hookTag: 'question-opener', postedAt: fiveDaysAgo },
        { platform: Platform.X, status: DraftStatus.Posted, body: 'b', hookTag: 'bold-claim', postedAt: fiveDaysAgo },
      ])
      .returning();
    await db.insert(postMetricsSnapshots).values([
      { draftId: a!.id, impressions: 1000, engagement: 50 },
      { draftId: b!.id, impressions: 10000, engagement: 200 },
    ]);
    await db.insert(attributions).values([
      { draftId: a!.id, subscriberId: 's1', signedUpAt: fiveDaysAgo, utmPayload: {} },
      { draftId: a!.id, subscriberId: 's2', signedUpAt: fiveDaysAgo, utmPayload: {} },
      { draftId: b!.id, subscriberId: 's3', signedUpAt: fiveDaysAgo, utmPayload: {} },
    ]);

    const r = await topHooksLastNDays({ days: 7, limit: 10 });
    // a: 2 signups / 1000 impressions = 2.0/1k
    // b: 1 signup / 10000 = 0.1/1k
    expect(r[0]!.hookTag).toBe('question-opener');
    expect(r[0]!.signupsPer1kImpressions).toBeCloseTo(2.0, 1);
    expect(r[1]!.hookTag).toBe('bold-claim');
  });

  it('excludes posts older than N days', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400_000);
    const [a] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'old', hookTag: 'question-opener', postedAt: eightDaysAgo })
      .returning();
    await db.insert(postMetricsSnapshots).values({ draftId: a!.id, impressions: 1000, engagement: 50 });

    const r = await topHooksLastNDays({ days: 7, limit: 10 });
    expect(r).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run, expect fail**

Run: `pnpm install && pnpm --filter @paperclip/analytics-mcp test`

- [ ] **Step 5: Implement `mcp/analytics-mcp/src/queries/topHooksLastNDays.ts`**

```ts
import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface HookRanking {
  hookTag: string | null;
  signups: number;
  impressions: number;
  signupsPer1kImpressions: number;
}

export async function topHooksLastNDays(input: { days: number; limit?: number }): Promise<HookRanking[]> {
  const limit = input.limit ?? 10;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const result = (await db.execute(sql`
    WITH posted AS (
      SELECT id, hook_tag FROM drafts
      WHERE posted_at IS NOT NULL AND posted_at >= ${cutoff}
    ),
    by_hook AS (
      SELECT p.hook_tag,
             COUNT(DISTINCT a.subscriber_id)::int AS signups,
             COALESCE(SUM(s.impressions), 0)::int AS impressions
      FROM posted p
      LEFT JOIN attributions a ON a.draft_id = p.id
      LEFT JOIN post_metrics_snapshots s ON s.draft_id = p.id
      GROUP BY p.hook_tag
    )
    SELECT hook_tag AS "hookTag", signups, impressions,
           CASE WHEN impressions > 0 THEN (signups::float / impressions) * 1000 ELSE 0 END AS "signupsPer1kImpressions"
    FROM by_hook
    ORDER BY "signupsPer1kImpressions" DESC NULLS LAST, signups DESC
    LIMIT ${limit}
  `)) as unknown as { rows: HookRanking[] };
  return result.rows;
}
```

- [ ] **Step 6: Run, expect pass**

- [ ] **Step 7: Commit**

```bash
git add mcp/analytics-mcp/ pnpm-lock.yaml
git commit -m "feat(analytics-mcp): scaffold + topHooksLastNDays query"
```

---

### Task 2: Remaining analytics queries

**Files:**
- Create: `mcp/analytics-mcp/src/queries/topThemesLastNDays.ts`
- Create: `mcp/analytics-mcp/src/queries/topWinnersByPlatform.ts`
- Create: `mcp/analytics-mcp/src/queries/postsLastNDays.ts`
- Create: `mcp/analytics-mcp/src/queries/attributionsLastNDays.ts`
- Create: `mcp/analytics-mcp/src/queries/getLastDigest.ts`
- Create: `mcp/analytics-mcp/tests/topWinnersByPlatform.test.ts`

- [ ] **Step 1: `mcp/analytics-mcp/src/queries/topThemesLastNDays.ts`**

```ts
import { db } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface ThemeRanking {
  themeSlug: string | null;
  signups: number;
  impressions: number;
  signupsPer1kImpressions: number;
}

export async function topThemesLastNDays(input: { days: number; limit?: number }): Promise<ThemeRanking[]> {
  const limit = input.limit ?? 10;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const r = (await db.execute(sql`
    WITH posted AS (
      SELECT d.id, t.slug AS theme_slug FROM drafts d
      LEFT JOIN themes t ON t.id = d.theme_id
      WHERE d.posted_at IS NOT NULL AND d.posted_at >= ${cutoff}
    ),
    by_theme AS (
      SELECT p.theme_slug,
             COUNT(DISTINCT a.subscriber_id)::int AS signups,
             COALESCE(SUM(s.impressions), 0)::int AS impressions
      FROM posted p
      LEFT JOIN attributions a ON a.draft_id = p.id
      LEFT JOIN post_metrics_snapshots s ON s.draft_id = p.id
      GROUP BY p.theme_slug
    )
    SELECT theme_slug AS "themeSlug", signups, impressions,
           CASE WHEN impressions > 0 THEN (signups::float / impressions) * 1000 ELSE 0 END AS "signupsPer1kImpressions"
    FROM by_theme
    ORDER BY "signupsPer1kImpressions" DESC, signups DESC
    LIMIT ${limit}
  `)) as unknown as { rows: ThemeRanking[] };
  return r.rows;
}
```

- [ ] **Step 2: Failing test `mcp/analytics-mcp/tests/topWinnersByPlatform.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, postMetricsSnapshots, attributions, DraftStatus, Platform } from '@paperclip/db';
import { topWinnersByPlatform } from '../src/queries/topWinnersByPlatform.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(postMetricsSnapshots);
  await db.delete(drafts);
});

describe('topWinnersByPlatform', () => {
  it('returns posts ranked by attributed signups, with body', async () => {
    const recent = new Date();
    const [a, b] = await db
      .insert(drafts)
      .values([
        { platform: Platform.X, status: DraftStatus.Posted, body: 'tweet A', hookTag: 'question-opener', postedAt: recent },
        { platform: Platform.X, status: DraftStatus.Posted, body: 'tweet B', hookTag: 'bold-claim', postedAt: recent },
      ])
      .returning();
    await db.insert(postMetricsSnapshots).values([
      { draftId: a!.id, impressions: 1000, engagement: 50 },
      { draftId: b!.id, impressions: 2000, engagement: 100 },
    ]);
    await db.insert(attributions).values([
      { draftId: a!.id, subscriberId: 's1', signedUpAt: recent, utmPayload: {} },
      { draftId: a!.id, subscriberId: 's2', signedUpAt: recent, utmPayload: {} },
      { draftId: a!.id, subscriberId: 's3', signedUpAt: recent, utmPayload: {} },
      { draftId: b!.id, subscriberId: 's4', signedUpAt: recent, utmPayload: {} },
    ]);

    const r = await topWinnersByPlatform({ platform: Platform.X, days: 28, limit: 5 });
    expect(r[0]!.body).toBe('tweet A');
    expect(r[0]!.signups).toBe(3);
    expect(r[1]!.body).toBe('tweet B');
  });
});
```

- [ ] **Step 3: Implement `mcp/analytics-mcp/src/queries/topWinnersByPlatform.ts`**

```ts
import { db, type Platform } from '@paperclip/db';
import { sql } from 'drizzle-orm';

export interface Winner {
  draftId: string;
  body: string;
  hookTag: string | null;
  signups: number;
  impressions: number;
}

export async function topWinnersByPlatform(input: { platform: Platform; days: number; limit?: number }): Promise<Winner[]> {
  const limit = input.limit ?? 5;
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  const r = (await db.execute(sql`
    SELECT d.id AS "draftId", d.body, d.hook_tag AS "hookTag",
           COUNT(DISTINCT a.subscriber_id)::int AS signups,
           COALESCE(SUM(s.impressions), 0)::int AS impressions
    FROM drafts d
    LEFT JOIN attributions a ON a.draft_id = d.id
    LEFT JOIN post_metrics_snapshots s ON s.draft_id = d.id
    WHERE d.platform = ${input.platform}
      AND d.posted_at IS NOT NULL AND d.posted_at >= ${cutoff}
    GROUP BY d.id
    ORDER BY signups DESC, impressions DESC
    LIMIT ${limit}
  `)) as unknown as { rows: Winner[] };
  return r.rows;
}
```

- [ ] **Step 4: Implement `postsLastNDays`**

```ts
// mcp/analytics-mcp/src/queries/postsLastNDays.ts
import { db, drafts } from '@paperclip/db';
import { and, gte, isNotNull, desc } from 'drizzle-orm';

export async function postsLastNDays(input: { days: number }) {
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  return db
    .select()
    .from(drafts)
    .where(and(isNotNull(drafts.postedAt), gte(drafts.postedAt, cutoff)))
    .orderBy(desc(drafts.postedAt));
}
```

- [ ] **Step 5: Implement `attributionsLastNDays`**

```ts
// mcp/analytics-mcp/src/queries/attributionsLastNDays.ts
import { db, attributions } from '@paperclip/db';
import { gte, desc } from 'drizzle-orm';

export async function attributionsLastNDays(input: { days: number }) {
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  return db
    .select()
    .from(attributions)
    .where(gte(attributions.signedUpAt, cutoff))
    .orderBy(desc(attributions.signedUpAt));
}
```

- [ ] **Step 6: Implement `getLastDigest`**

```ts
// mcp/analytics-mcp/src/queries/getLastDigest.ts
import { db, digests } from '@paperclip/db';
import { eq, desc } from 'drizzle-orm';

export async function getLastDigest(input: { kind: 'daily' | 'weekly' }) {
  const [row] = await db
    .select()
    .from(digests)
    .where(eq(digests.kind, input.kind))
    .orderBy(desc(digests.createdAt))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @paperclip/analytics-mcp test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add mcp/analytics-mcp/src/queries/ mcp/analytics-mcp/tests/topWinnersByPlatform.test.ts
git commit -m "feat(analytics-mcp): topThemes, topWinners, posts/attributionsLastNDays, getLastDigest"
```

---

### Task 3: `writeDigest` tool + MCP server entrypoint (TDD)

**Files:**
- Create: `mcp/analytics-mcp/src/tools/writeDigest.ts`
- Create: `mcp/analytics-mcp/src/server.ts`
- Create: `mcp/analytics-mcp/tests/writeDigest.test.ts`

- [ ] **Step 1: Failing test**

```ts
// mcp/analytics-mcp/tests/writeDigest.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, digests } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { writeDigest } from '../src/tools/writeDigest.js';

beforeEach(async () => { await db.delete(digests); });

describe('writeDigest', () => {
  it('inserts a digest row', async () => {
    const r = await writeDigest({ kind: 'daily', contentMd: '# yesterday\n- top performer X' });
    expect(r.id).toBeDefined();
    const rows = await db.select().from(digests).where(eq(digests.id, r.id));
    expect(rows[0]!.contentMd).toContain('yesterday');
  });

  it('rejects unknown kind', async () => {
    // @ts-expect-error intentionally bad
    await expect(writeDigest({ kind: 'monthly', contentMd: 'x' })).rejects.toThrow(/kind/i);
  });
});
```

- [ ] **Step 2: Implement `mcp/analytics-mcp/src/tools/writeDigest.ts`**

```ts
import { db, digests } from '@paperclip/db';

export async function writeDigest(input: { kind: 'daily' | 'weekly'; contentMd: string }) {
  if (input.kind !== 'daily' && input.kind !== 'weekly') {
    throw new Error(`invalid kind: ${input.kind}`);
  }
  const [row] = await db
    .insert(digests)
    .values({ kind: input.kind, contentMd: input.contentMd })
    .returning();
  return row!;
}
```

- [ ] **Step 3: Implement `mcp/analytics-mcp/src/server.ts`**

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Platform } from '@paperclip/db';
import { topHooksLastNDays } from './queries/topHooksLastNDays.js';
import { topThemesLastNDays } from './queries/topThemesLastNDays.js';
import { topWinnersByPlatform } from './queries/topWinnersByPlatform.js';
import { postsLastNDays } from './queries/postsLastNDays.js';
import { attributionsLastNDays } from './queries/attributionsLastNDays.js';
import { getLastDigest } from './queries/getLastDigest.js';
import { writeDigest } from './tools/writeDigest.js';

const daysSchema = z.object({ days: z.number().int().min(1).max(365), limit: z.number().optional() });
const platformDaysSchema = z.object({ platform: z.enum([Platform.X, Platform.LinkedIn]), days: z.number().int().min(1), limit: z.number().optional() });
const digestKind = z.object({ kind: z.enum(['daily', 'weekly']) });
const writeDigestSchema = z.object({ kind: z.enum(['daily', 'weekly']), contentMd: z.string().min(1) });

const server = new Server({ name: 'analytics-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'topHooksLastNDays', description: 'Rank hooks by signups/1k impressions', inputSchema: { type: 'object' } },
    { name: 'topThemesLastNDays', description: 'Rank themes by signups/1k impressions', inputSchema: { type: 'object' } },
    { name: 'topWinnersByPlatform', description: 'Best posts on a platform', inputSchema: { type: 'object' } },
    { name: 'postsLastNDays', description: 'List recent posts', inputSchema: { type: 'object' } },
    { name: 'attributionsLastNDays', description: 'List recent attributions', inputSchema: { type: 'object' } },
    { name: 'getLastDigest', description: 'Get the most recent digest of a given kind', inputSchema: { type: 'object' } },
    { name: 'writeDigest', description: 'Persist a daily or weekly digest', inputSchema: { type: 'object' } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'topHooksLastNDays': result = await topHooksLastNDays(daysSchema.parse(args)); break;
      case 'topThemesLastNDays': result = await topThemesLastNDays(daysSchema.parse(args)); break;
      case 'topWinnersByPlatform': result = await topWinnersByPlatform(platformDaysSchema.parse(args)); break;
      case 'postsLastNDays': result = await postsLastNDays(daysSchema.parse(args)); break;
      case 'attributionsLastNDays': result = await attributionsLastNDays(daysSchema.parse(args)); break;
      case 'getLastDigest': result = await getLastDigest(digestKind.parse(args)); break;
      case 'writeDigest': result = await writeDigest(writeDigestSchema.parse(args)); break;
      default: throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `ERROR: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Build + run tests**

```bash
pnpm --filter @paperclip/analytics-mcp test
pnpm --filter @paperclip/analytics-mcp build
```

- [ ] **Step 5: Commit**

```bash
git add mcp/analytics-mcp/src/tools/ mcp/analytics-mcp/src/server.ts mcp/analytics-mcp/tests/writeDigest.test.ts
git commit -m "feat(analytics-mcp): writeDigest + MCP server entrypoint"
```

---

### Task 4: Remove `optional: true` from analytics MCP in Paperclip config + agent YAMLs

**Files:**
- Modify: `paperclip-config/paperclip.yaml`
- Modify: `agents/chief_of_staff.yaml`
- Modify: `agents/strategist.yaml`
- Modify: `agents/copywriter_x.yaml`
- Modify: `agents/copywriter_linkedin.yaml`
- Modify: `agents/analyst.yaml`

- [ ] **Step 1: Remove `optional: true` from analytics entries**

In `paperclip-config/paperclip.yaml`, remove the `optional: true` line on the `analytics` MCP entry.

In each agent YAML listed above, remove `optional: true` from the analytics tool block.

- [ ] **Step 2: Add analytics-mcp to docker-compose**

In `infra/docker-compose.yml`, append under services (alongside other MCPs):

```yaml
  analytics-mcp:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: analytics-mcp, KIND: mcp }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip
```

- [ ] **Step 3: Rebuild + verify Paperclip starts cleanly**

```bash
docker compose -f infra/docker-compose.yml --profile full build analytics-mcp paperclip
docker compose -f infra/docker-compose.yml --profile full up -d
docker compose -f infra/docker-compose.yml logs paperclip | grep -i mcp
```
Expected: paperclip logs show analytics-mcp connected.

- [ ] **Step 4: Commit**

```bash
git add paperclip-config/ agents/ infra/
git commit -m "feat: wire analytics-mcp into paperclip config (no longer optional)"
```

---

### Task 5: Promptfoo scaffolding + shared judge

**Files:**
- Create: `evals/README.md`
- Create: `evals/promptfooconfig.base.yaml`
- Create: `evals/shared/judge.yaml`
- Create: `evals/shared/fixtures/voice.md`
- Modify: root `package.json`

- [ ] **Step 1: Install promptfoo at root**

Add to root `package.json` devDependencies:
```json
"promptfoo": "0.91.0"
```

And to scripts:
```json
"evals": "promptfoo eval",
"evals:replay": "promptfoo eval --config evals/promptfooconfig.base.yaml"
```

- [ ] **Step 2: `evals/README.md`**

```markdown
# Evals

Golden-set evaluations gating prompt changes. Each agent that produces structured output has its own subdir with:

- `promptfooconfig.yaml` — the prompt under test + case glob.
- `cases/*.yaml` — canned inputs (brief + research blob).

A shared `judge.yaml` defines the eval-judge prompt that scores agent outputs against the rubric. The judge runs on a DIFFERENT model than the agent under test (the agent uses smart/cheap from paperclip.yaml; the judge uses Sonnet).

## Running

```bash
# Replay-mode (uses cached LLM responses if recorded). Fast, free, CI-friendly.
PROMPTFOO_REPLAY=1 pnpm evals

# Live mode (calls the real model). Run nightly + before major releases.
pnpm evals
```

## Promotion criterion

A change is promotable iff `pass_rate >= 0.95` on the affected agent's set. CI enforces this.
```

- [ ] **Step 3: `evals/promptfooconfig.base.yaml`**

```yaml
# Base promptfoo settings shared by per-agent configs.
defaultTest:
  options:
    provider:
      id: anthropic:messages:claude-opus-4-7
      config:
        apiKey: file://./.env
providers:
  - id: agent_under_test
    config:
      apiKey: env:ANTHROPIC_API_KEY
sharedTransform: |
  // No transform — agents return JSON-stringified structures
outputPath: ./.promptfoo-results
```

- [ ] **Step 4: `evals/shared/judge.yaml`**

```yaml
judge:
  model: anthropic:messages:claude-sonnet-4-6
  rubric: |
    You are an evaluator for newsletter marketing content. Given:
    - INPUT: a brief + research blob, brand voice rules, risk rules, hook taxonomy
    - OUTPUT: the agent's draft(s)

    Score the output on these dimensions, return JSON:
    {
      "voice_match": 0.0..1.0,
      "no_banned_phrases": true|false,
      "has_required_hook_tag": true|false,
      "honors_char_limit": true|false,
      "has_exactly_one_newsletter_link": true|false,
      "factually_grounded_in_research": 0.0..1.0,
      "overall_pass": true|false,
      "notes": "1-2 sentences"
    }

    Score conservatively. "overall_pass": true requires ALL booleans true and both 0..1 metrics >= 0.7.
```

- [ ] **Step 5: `evals/shared/fixtures/voice.md`**

```markdown
# Voice fixture (kept in sync with policies/brand_voice.md)
[copy contents of policies/brand_voice.md here, or symlink]
```

- [ ] **Step 6: Commit**

```bash
git add evals/ package.json pnpm-lock.yaml
git commit -m "feat(evals): scaffold promptfoo + shared judge rubric"
```

---

### Task 6: Copywriter-X eval set (20 cases)

**Files:**
- Create: `evals/copywriter_x/promptfooconfig.yaml`
- Create: `evals/copywriter_x/cases/001-launch-announce.yaml` through `020-...yaml`

- [ ] **Step 1: `evals/copywriter_x/promptfooconfig.yaml`**

```yaml
description: Copywriter-X golden set
prompts:
  - file://../../agents/copywriter_x.yaml
providers:
  - id: anthropic:messages:claude-opus-4-7
tests:
  - vars:
      brief: file://cases/{{case}}.yaml#brief
      research: file://cases/{{case}}.yaml#research
    assert:
      - type: javascript
        value: |
          // Output is expected to be 3 drafts as JSON array
          const out = JSON.parse(output);
          if (!Array.isArray(out) || out.length !== 3) return { pass: false, reason: 'expected 3 drafts' };
          for (const d of out) {
            if (!d.hook_tag) return { pass: false, reason: 'missing hook_tag' };
            if (d.body.length > 280) return { pass: false, reason: `tweet too long: ${d.body.length}` };
            const matches = d.body.match(/https?:\/\//g) ?? [];
            if (matches.length !== 1) return { pass: false, reason: `expected exactly 1 link, got ${matches.length}` };
          }
          return { pass: true };
      - type: llm-rubric
        provider: anthropic:messages:claude-sonnet-4-6
        value: file://../shared/judge.yaml#rubric

scenarios:
  - description: per-case
    cases:
      - case: '001-launch-announce'
      - case: '002-counterintuitive'
      - case: '003-numbered-list'
      - case: '004-personal-story'
      - case: '005-bold-claim-product'
      - case: '006-bold-claim-stat'
      - case: '007-question-opener-howto'
      - case: '008-behind-the-scenes-shipping'
      - case: '009-thread-3-tweet'
      - case: '010-quote-then-reframe'
      - case: '011-comparison-to-baseline'
      - case: '012-mid-cycle-update'
      - case: '013-celebration-cautious'
      - case: '014-tool-mention'
      - case: '015-mistake-we-made'
      - case: '016-before-after-metric'
      - case: '017-prediction'
      - case: '018-link-share-with-take'
      - case: '019-respond-to-trend'
      - case: '020-no-research-edge-case'
```

- [ ] **Step 2: Write case `evals/copywriter_x/cases/001-launch-announce.yaml`**

```yaml
brief:
  audience: "indie devs and founders running newsletters"
  angle: "we shipped the first end-to-end autonomous marketing agency for a newsletter"
  platforms: ["x"]
  suggested_hooks: ["behind-the-scenes", "bold-claim", "numbered-list"]
  key_points:
    - "8 agents, 1 human approval queue"
    - "X auto-posts; LinkedIn paste manually"
    - "Open source, MIT, self-hosted"

research:
  trends:
    - "agentic dev tools (claude code, cursor) gaining traction"
    - "newsletter marketing as a discipline reaching tipping point"
  top_posts:
    - platform: x
      text: "shipped: 4 agents that handle my whole newsletter marketing pipeline. budget: $40/mo."
      engagement: 1500
    - platform: x
      text: "the answer to 'should I automate this?' is almost always: only if you can measure it."
      engagement: 900
  audience_notes: "Active 7-9am ET. Reply rate higher on bold-claim opens."
  open_questions:
    - "are people ready to trust agents with brand voice?"
```

- [ ] **Step 3: Create cases 002 through 020**

Each follows the same shape: `brief` and `research` blobs. Realistic theme variety per the case names in the config. Total: 20 cases.

> **For the executor:** Spending ~10-15 minutes per case is reasonable. Use real-world themes you'd actually post about, not toy examples. Case 020 ("no-research-edge-case") deliberately leaves `research` near-empty to test graceful behavior.

- [ ] **Step 4: Run replay-mode (will record on first run)**

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm evals --config evals/copywriter_x/promptfooconfig.yaml
```
Expected: 20 cases × ~3-second LLM call ≈ 1 minute. Output: pass/fail per case + summary.

- [ ] **Step 5: Commit**

```bash
git add evals/copywriter_x/
git commit -m "test(evals): Copywriter-X 20-case golden set + javascript + llm-rubric assertions"
```

---

### Task 7: Copywriter-LinkedIn eval set (15 cases)

**Files:**
- Create: `evals/copywriter_linkedin/promptfooconfig.yaml`
- Create: `evals/copywriter_linkedin/cases/*.yaml` (15 cases)

- [ ] **Step 1: `evals/copywriter_linkedin/promptfooconfig.yaml`**

```yaml
description: Copywriter-LinkedIn golden set
prompts:
  - file://../../agents/copywriter_linkedin.yaml
providers:
  - id: anthropic:messages:claude-opus-4-7
tests:
  - vars:
      brief: file://cases/{{case}}.yaml#brief
      research: file://cases/{{case}}.yaml#research
    assert:
      - type: javascript
        value: |
          const out = JSON.parse(output);
          if (!Array.isArray(out) || out.length !== 3) return { pass: false, reason: 'expected 3 drafts' };
          for (const d of out) {
            if (!d.hook_tag) return { pass: false, reason: 'missing hook_tag' };
            if (d.body.length > 3000) return { pass: false, reason: 'too long' };
            if (d.body.length < 600) return { pass: false, reason: 'too short for LinkedIn' };
            const matches = d.body.match(/https?:\/\//g) ?? [];
            if (matches.length !== 1) return { pass: false, reason: `expected exactly 1 link, got ${matches.length}` };
          }
          return { pass: true };
      - type: llm-rubric
        provider: anthropic:messages:claude-sonnet-4-6
        value: file://../shared/judge.yaml#rubric

scenarios:
  - description: per-case
    cases:
      - case: '001-product-launch'
      - case: '002-after-action-report'
      - case: '003-personal-lessons'
      - case: '004-counter-trend'
      - case: '005-numbered-takeaways'
      - case: '006-tool-comparison'
      - case: '007-process-deep-dive'
      - case: '008-question-from-readers'
      - case: '009-before-after-business'
      - case: '010-mistake-debrief'
      - case: '011-research-summary'
      - case: '012-data-narrative'
      - case: '013-prediction-2027'
      - case: '014-roundup-curation'
      - case: '015-empty-research-edge'
```

- [ ] **Step 2: Write 15 cases following the same pattern as Task 6 but with LinkedIn-shaped briefs.**

- [ ] **Step 3: Run + commit**

```bash
pnpm evals --config evals/copywriter_linkedin/promptfooconfig.yaml
git add evals/copywriter_linkedin/
git commit -m "test(evals): Copywriter-LinkedIn 15-case golden set"
```

---

### Task 8: Editor eval set (10 good + 10 bad)

**Files:**
- Create: `evals/editor/promptfooconfig.yaml`
- Create: `evals/editor/cases/*.yaml` (20 total)

- [ ] **Step 1: `evals/editor/promptfooconfig.yaml`**

```yaml
description: Editor golden set
prompts:
  - file://../../agents/editor.yaml
providers:
  - id: anthropic:messages:claude-opus-4-7
tests:
  - vars:
      draft: file://cases/{{case}}.yaml#draft
      expected_verdict: file://cases/{{case}}.yaml#expected_verdict
    assert:
      - type: javascript
        value: |
          const out = JSON.parse(output);
          const expected = context.vars.expected_verdict;
          if (out.verdict !== expected) {
            return { pass: false, reason: `verdict mismatch: got ${out.verdict}, expected ${expected}` };
          }
          if (typeof out.notes !== 'string' || out.notes.length === 0) {
            return { pass: false, reason: 'missing notes' };
          }
          return { pass: true };

scenarios:
  - description: per-case
    cases:
      # 10 should-approve cases:
      - case: '001-clean-question-opener'
      - case: '002-clean-bold-claim'
      - case: '003-clean-thread-3tweet'
      - case: '004-clean-linkedin-story'
      - case: '005-clean-numbered-list'
      - case: '006-clean-behind-the-scenes'
      - case: '007-clean-contrarian'
      - case: '008-clean-before-after'
      - case: '009-clean-linkedin-data'
      - case: '010-clean-question-li'
      # 10 should-reject cases (varied failure modes):
      - case: '011-fail-banned-phrase'
      - case: '012-fail-no-link'
      - case: '013-fail-two-links'
      - case: '014-fail-over-char-limit'
      - case: '015-fail-no-hook-tag'
      - case: '016-fail-medical-claim'
      - case: '017-fail-unverified-stat'
      - case: '018-fail-competitor-jab'
      - case: '019-fail-emoji-stuffing'
      - case: '020-fail-third-pass-must-reject'
```

- [ ] **Step 2: Write all 20 cases. Each has `draft` (the input the Editor sees) and `expected_verdict` (one of `approve`, `rework`, `editor_reject`).** Case 020 includes `reworkCount: 2` in the draft so the Editor must escalate to `editor_reject`.

- [ ] **Step 3: Run + commit**

```bash
pnpm evals --config evals/editor/promptfooconfig.yaml
git add evals/editor/
git commit -m "test(evals): Editor 20-case golden set (10 should-approve + 10 should-reject)"
```

---

### Task 9: CI workflow — eval gate

**Files:**
- Create: `.github/workflows/evals.yml`

- [ ] **Step 1: Write `.github/workflows/evals.yml`**

```yaml
name: evals
on:
  pull_request:
    paths:
      - 'agents/**'
      - 'policies/**'
      - 'evals/**'

jobs:
  evals:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      PROMPTFOO_REPLAY: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - name: Run Copywriter-X evals
        run: pnpm evals --config evals/copywriter_x/promptfooconfig.yaml --output json > x.json
      - name: Run Copywriter-LinkedIn evals
        run: pnpm evals --config evals/copywriter_linkedin/promptfooconfig.yaml --output json > li.json
      - name: Run Editor evals
        run: pnpm evals --config evals/editor/promptfooconfig.yaml --output json > ed.json
      - name: Enforce 95% pass rate
        run: |
          node <<'EOF'
          const fs = require('fs');
          for (const f of ['x.json', 'li.json', 'ed.json']) {
            const j = JSON.parse(fs.readFileSync(f, 'utf8'));
            const pass = j.results?.stats?.passes ?? 0;
            const fail = j.results?.stats?.failures ?? 0;
            const rate = pass / (pass + fail);
            console.log(`${f}: ${pass}/${pass+fail} = ${(rate*100).toFixed(1)}%`);
            if (rate < 0.95) { console.error(`${f}: pass_rate ${rate} < 0.95`); process.exit(1); }
          }
          EOF
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/evals.yml
git commit -m "ci: gate prompt changes on 95% pass rate across copywriter + editor evals"
```

---

### Task 10: Web shell — digests page + snapshot timeline chart

**Files:**
- Create: `apps/web/app/digests/page.tsx`
- Create: `apps/web/app/digests/[id]/page.tsx`
- Create: `apps/web/app/posts/[id]/SnapshotChart.tsx`
- Modify: `apps/web/app/posts/[id]/page.tsx`
- Modify: `apps/web/package.json` (+recharts +react-markdown)

- [ ] **Step 1: Add deps**

In `apps/web/package.json` dependencies:
```json
"recharts": "2.13.0",
"react-markdown": "9.0.1"
```

- [ ] **Step 2: `apps/web/app/digests/page.tsx`**

```tsx
import Link from 'next/link';
import { db, digests } from '@paperclip/db';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function DigestsPage() {
  const rows = await db.select().from(digests).orderBy(desc(digests.createdAt)).limit(50);
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Digests</h1>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((d) => (
          <li key={d.id} className="py-3">
            <Link href={`/digests/${d.id}`} className="block hover:underline">
              <span className="text-xs uppercase text-zinc-500 mr-2">{d.kind}</span>
              <span className="font-mono text-xs">{d.createdAt.toISOString().slice(0, 16)}</span>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-2">
                {d.contentMd.replace(/[#*]/g, '').slice(0, 200)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: `apps/web/app/digests/[id]/page.tsx`**

```tsx
import { db, digests } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';

export const dynamic = 'force-dynamic';

export default async function DigestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(digests).where(eq(digests.id, id));
  if (!row) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="space-y-1">
        <p className="text-xs uppercase text-zinc-500">{row.kind} digest</p>
        <p className="font-mono text-xs text-zinc-500">{row.createdAt.toISOString()}</p>
      </header>
      <article className="prose prose-zinc dark:prose-invert max-w-none">
        <Markdown>{row.contentMd}</Markdown>
      </article>
    </main>
  );
}
```

- [ ] **Step 4: `apps/web/app/posts/[id]/SnapshotChart.tsx`**

```tsx
'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Pt { capturedAt: string; impressions: number; engagement: number }

export function SnapshotChart({ points }: { points: Pt[] }) {
  const data = points.map((p) => ({
    t: new Date(p.capturedAt).toLocaleString(),
    impressions: p.impressions,
    engagement: p.engagement,
  }));
  if (data.length === 0) return <p className="text-sm text-zinc-500">No snapshots yet.</p>;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="t" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="impressions" />
          <Line type="monotone" dataKey="engagement" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Modify `apps/web/app/posts/[id]/page.tsx` to render chart and attributions**

Replace the file with:

```tsx
import { db, drafts, draftTransitions, postMetricsSnapshots, attributions } from '@paperclip/db';
import { eq, desc, asc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { SnapshotChart } from './SnapshotChart.js';

export const dynamic = 'force-dynamic';

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!row) notFound();
  const [history, snaps, atts] = await Promise.all([
    db.select().from(draftTransitions).where(eq(draftTransitions.draftId, id)).orderBy(desc(draftTransitions.at)),
    db.select().from(postMetricsSnapshots).where(eq(postMetricsSnapshots.draftId, id)).orderBy(asc(postMetricsSnapshots.capturedAt)),
    db.select().from(attributions).where(eq(attributions.draftId, id)).orderBy(desc(attributions.signedUpAt)),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Draft</h1>
        <p className="text-xs text-zinc-500">{row.id}</p>
      </header>
      <section className="rounded border border-zinc-300 dark:border-zinc-700 p-4">
        <div className="flex justify-between text-xs text-zinc-500 mb-2">
          <span>{row.platform.toUpperCase()} · {row.hookTag ?? 'no hook'}</span>
          <span>status: {row.status}</span>
        </div>
        <pre className="whitespace-pre-wrap text-sm font-sans">{row.body}</pre>
      </section>
      <section>
        <h2 className="text-lg font-medium mb-2">Performance ({atts.length} attributed signups)</h2>
        <SnapshotChart points={snaps.map((s) => ({ capturedAt: s.capturedAt.toISOString(), impressions: s.impressions, engagement: s.engagement }))} />
      </section>
      <section>
        <h2 className="text-lg font-medium mb-2">History</h2>
        <ol className="text-sm space-y-1">
          {history.map((h) => (
            <li key={h.id} className="font-mono">
              <span className="text-zinc-500">{h.at.toISOString()}</span>{' '}
              <span>{h.fromStatus ?? '∅'} → {h.toStatus}</span>{' '}
              <span className="text-zinc-500">({h.actor})</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/ pnpm-lock.yaml
git commit -m "feat(web): digests pages + snapshot timeline chart on per-post detail"
```

---

### Task 11: Plug analytics into Copywriter few-shot loop

**Files:**
- Modify: `agents/copywriter_x.yaml`
- Modify: `agents/copywriter_linkedin.yaml`

- [ ] **Step 1: Update `agents/copywriter_x.yaml` system_prompt**

Replace the "If analytics is available" line with a stronger directive (now that analytics-mcp is non-optional):

```yaml
system_prompt: |
  ...
  2. Call analytics.topWinnersByPlatform({ platform: "x", days: 28, limit: 5 }) and include the returned bodies in your context as VOICE ANCHORS — do not copy them verbatim, but match their cadence and structure.
  3. Call analytics.topHooksLastNDays({ days: 28, limit: 5 }). When choosing your 3 hook_tag selections, bias toward hooks ranked in the top 5 unless the brief explicitly mandates a specific hook.
  ...
```

- [ ] **Step 2: Update `agents/copywriter_linkedin.yaml` similarly**

- [ ] **Step 3: Commit**

```bash
git add agents/
git commit -m "feat(agents): copywriters consume top-5 winners + top hooks as few-shot anchors"
```

---

### Task 12: Verify the full loop end-to-end

**Files:** None — verification only.

- [ ] **Step 1: Boot, brief, and watch the loop close**

```bash
docker compose -f infra/docker-compose.yml --profile full up -d
pnpm brief "Theme: what AI agencies get wrong about voice"
# Watch /queue for ~10min. Approve 1-2 drafts. Wait for scheduler to post.
# Wait ~24h for first +24h snapshot or fast-forward by inserting a synthetic snapshot:
psql "$DATABASE_URL" -c "INSERT INTO post_metrics_snapshots(draft_id, impressions, engagement) SELECT id, 5000, 250 FROM drafts WHERE status='posted' LIMIT 1;"
# Tomorrow at 07:30 the Analyst writes a daily digest. View at /digests.
```

- [ ] **Step 2: Confirm Copywriter uses analytics**

Re-run `pnpm brief "..."` and inspect a draft's Paperclip ticket trail (port 8080). Confirm the Copywriter called `analytics.topWinnersByPlatform` and `analytics.topHooksLastNDays`.

- [ ] **Step 3: Confirm CI eval gate**

Open a branch, change one word in `policies/brand_voice.md` (e.g., remove "warm"), open a PR. Watch CI — evals should still pass (subtle change). Now add a banned phrase by *removing* the "Game changer" ban — re-run, evals should drop. Revert.

- [ ] **Step 4: No commits; verification only**

---

### Self-Review

**Spec coverage:**
- analytics-mcp queries (topHooks, topThemes, topWinners, postsLastN, attributionsLastN, getLastDigest) — Tasks 1-2. ✓
- writeDigest + server — Task 3. ✓
- Removed `optional: true` from Paperclip config — Task 4. ✓
- Promptfoo harness + shared judge — Task 5. ✓
- Copywriter-X 20 cases — Task 6. ✓
- Copywriter-LinkedIn 15 cases — Task 7. ✓
- Editor 20 cases (10 good + 10 bad) — Task 8. ✓
- CI eval gate at 95% — Task 9. ✓
- Digest UI + snapshot chart — Task 10. ✓
- Few-shot loop wired — Task 11. ✓

**Placeholder scan:** Case YAMLs 002-020 / 002-015 / 002-020 are *defined by name* but the executor must write the actual contents. This is intentional — eval content is domain-specific and shouldn't be made up by an agent. Task 6/7/8 Step 3 calls this out as a 10-15-min/case task for the executor.

**Type consistency:** `signupsPer1kImpressions`, `HookRanking`, `Winner`, `ThemeRanking`, `writeDigest`, `getLastDigest` consistent. The `digests.kind` enum (`'daily' | 'weekly'`) is validated everywhere.

---

### What you have after Plan 5

The agency now optimizes itself. Every Friday the Analyst writes a leaderboard. Every Monday the Strategist reads it and picks themes. Every draft cites top-5 winners as voice anchors. Every prompt change goes through CI eval gate. The web shell has digests, leaderboards, and per-post performance charts. ~12 commits, ~3000 LoC.
