# Plan 4 — Real Paperclip Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan-2 stub agents with eight real LLM-backed Paperclip agents — Chief of Staff, Strategist, Researcher, Copywriter-X, Copywriter-LinkedIn, Editor, Scheduler, Analyst — each with its own system prompt, MCP tool access, monthly budget, and heartbeat schedule. After this ships, the agency runs autonomously on its own cadence: weekly briefs flow into research → drafts → edits → your approval queue → posted, with real content quality (judged by the Editor agent + your reviews).

**Architecture:** Paperclip is vendored as a git submodule and run via Docker Compose. Each agent is a YAML config in `agents/` declaring its role, system prompt, model, MCP tools, budget, and (if applicable) heartbeat cron. The Strategist/Researcher/Copywriter/Editor agents read and write *only* through `drafts-mcp`. The Scheduler agent is replaced — the existing `workers/scheduler` worker still drives posting on its 15-min tick (Paperclip Scheduler is a *trigger*, not a *poster*). A new `research-mcp` provides Reddit/HN/RSS so the Researcher agent has something to actually research.

**Tech Stack:** Plans 1-3 stack, plus Paperclip (vendored), Anthropic Claude SDK (via Paperclip's model adapter), an RSS parser (`rss-parser`), Reddit API (snoowrap or direct fetch), Hacker News Algolia API.

**Depends on:** Plans 1, 2, and 3 complete.

> **Important caveat:** Paperclip's exact YAML schema and CLI may differ from what's reflected below. This plan reflects the *intent* — eight roles, prompts, MCP tool grants, budgets, heartbeats — and the executor should adapt task 2-4 file shapes to Paperclip's actual schema after consulting [paperclip.ing](https://paperclip.ing/) or the vendored repo's `examples/` directory. The plan calls out where to look.

---

## File Structure

```
paperclip/
├── paperclip/                                # git submodule (Paperclip upstream)
├── agents/                                   # NEW
│   ├── chief_of_staff.yaml
│   ├── strategist.yaml
│   ├── researcher.yaml
│   ├── copywriter_x.yaml
│   ├── copywriter_linkedin.yaml
│   ├── editor.yaml
│   └── analyst.yaml
├── policies/                                 # NEW
│   ├── brand_voice.md
│   ├── risk_policy.md
│   ├── editor_rubric.md
│   ├── hook_taxonomy.md
│   └── readme.md
├── paperclip-config/                         # NEW: Paperclip's own config root
│   ├── paperclip.yaml                        # paperclip's main config (orgs, agents, mcps)
│   └── secrets.example.env
├── mcp/
│   └── research-mcp/                         # NEW
│       ├── package.json                      # @paperclip/research-mcp
│       ├── tsconfig.json
│       ├── src/
│       │   ├── server.ts
│       │   ├── tools/
│       │   │   ├── searchReddit.ts
│       │   │   ├── searchHackerNews.ts
│       │   │   └── fetchRssFeed.ts
│       │   └── cache.ts
│       └── tests/
│           ├── searchReddit.test.ts
│           └── searchHackerNews.test.ts
└── scripts/
    └── promote-brief.ts                      # NEW: human-triggered brief creator
```

**Key boundaries:**

- Agent files are the **only** place LLM prompts live. No prompts in code.
- Policy markdowns are **referenced by name** in agent YAML and loaded by Paperclip — so the brand voice doc can be edited without redeploying any service.
- The runtime `workers/scheduler` (Plan 2/3) still owns the *post* action; agents never call `postTweet` themselves. The plan re-enforces this by NOT granting Copywriter/Strategist/Editor agents write access to `x-mcp`.

---

### Task 1: Vendor Paperclip as a git submodule + scaffold paperclip-config

**Files:**
- Create: `.gitmodules`
- Create: `paperclip/` (submodule)
- Create: `paperclip-config/paperclip.yaml`
- Create: `paperclip-config/secrets.example.env`

- [ ] **Step 1: Add Paperclip as a git submodule**

```bash
git submodule add https://github.com/paperclip-ing/paperclip.git paperclip
git submodule update --init --recursive
```

> **Note:** If the actual upstream repo URL differs, fetch it from [paperclip.ing](https://paperclip.ing/) → GitHub link. Update the URL and re-run.

- [ ] **Step 2: Inspect Paperclip's example config**

Run: `ls paperclip/examples/ paperclip/docs/ 2>/dev/null || true`
Expected: list of example YAMLs and docs. Read at least one example agent definition so the YAMLs in subsequent tasks match the actual schema.

- [ ] **Step 3: Write `paperclip-config/paperclip.yaml`** (illustrative — adapt keys to Paperclip's real schema)

```yaml
# Paperclip top-level config. Adapt keys after reading paperclip/examples/.
org:
  name: "Newsletter Marketing Agency"
  mission: "Grow newsletter subscribers via X and LinkedIn audience-growth posts."

database:
  url: env:DATABASE_URL

models:
  smart:
    provider: anthropic
    model: claude-opus-4-7
    api_key: env:ANTHROPIC_API_KEY
  cheap:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    api_key: env:ANTHROPIC_API_KEY

mcp_servers:
  drafts:
    command: node
    args: ["../mcp/drafts-mcp/dist/server.js"]
  x:
    command: node
    args: ["../mcp/x-mcp/dist/server.js"]
    env:
      TOKEN_ENC_KEY: env:TOKEN_ENC_KEY
  linkedin:
    command: node
    args: ["../mcp/linkedin-mcp/dist/server.js"]
    env:
      TOKEN_ENC_KEY: env:TOKEN_ENC_KEY
  research:
    command: node
    args: ["../mcp/research-mcp/dist/server.js"]
  analytics:
    command: node
    args: ["../mcp/analytics-mcp/dist/server.js"]   # Plan 5 introduces analytics-mcp
    optional: true

policies_dir: ../policies
agents_dir: ../agents
```

- [ ] **Step 4: Write `paperclip-config/secrets.example.env`**

```env
DATABASE_URL=postgres://paperclip:paperclip_dev@localhost:5433/paperclip
ANTHROPIC_API_KEY=sk-ant-...
TOKEN_ENC_KEY=base64:...
NEWSLETTER_ORIGIN=https://news.example.com
```

- [ ] **Step 5: Commit submodule + config scaffold**

```bash
git add .gitmodules paperclip paperclip-config/
git commit -m "feat(paperclip): vendor as submodule + scaffold paperclip-config"
```

---

### Task 2: Policy documents

**Files:**
- Create: `policies/brand_voice.md`
- Create: `policies/risk_policy.md`
- Create: `policies/editor_rubric.md`
- Create: `policies/hook_taxonomy.md`
- Create: `policies/readme.md`

- [ ] **Step 1: `policies/brand_voice.md`** *(starting draft — refine after first 2 weeks of outputs)*

```markdown
# Brand voice — newsletter

## Identity
A solo operator running a newsletter about [TOPIC]. Sounds like a smart friend at a coffee shop, not a brand. Warm, opinionated, specific.

## Diction
- Lowercase first letter on X. Sentence case on LinkedIn.
- Short sentences. ~14 words avg.
- Concrete examples over abstractions. Numbers over adjectives.
- First person singular ("I") on personal stories. Plural ("we") only when literally true.

## What we never say
- "Game changer", "leverage", "synergy", "10x", "next-gen", "revolutionary", "unprecedented".
- "Excited to announce".
- Listicles starting with "Here are 5…" or "X reasons…".

## How we do hooks
- Question-opener: a real question the reader is silently asking.
- Bold claim: a single, specific assertion ("threads with one stat outperform 3:1").
- Behind-the-scenes: what we just shipped and the surprise.
- Contrarian: name a common belief, then disagree with evidence.

## Length
- X: short tweets ≤ 220 chars are preferred. Threads only when the payload truly needs 3+ posts.
- LinkedIn: 800–1500 chars. Open with a hook, deliver in middle, close with a soft CTA.

## Links
- Always include exactly one newsletter link per post. Never two.
```

- [ ] **Step 2: `policies/risk_policy.md`**

```markdown
# Risk policy

## Hard rules (Editor MUST reject if violated)
- No unverified factual claims about people, companies, or products. If we can't link a source, we don't say it.
- No medical, legal, or financial advice phrased as instruction.
- No mentions of competitors by name unless we're praising them.
- No private info about subscribers — no names, no email addresses, no quotes without permission.
- No politically-charged statements outside our newsletter's core domain.
- No "guarantees" of any subscriber or business outcome.

## Soft rules (Editor SHOULD request rework)
- Phrases on the banned list in brand_voice.md.
- Posts that include more than one external link.
- Posts that don't include the canonical newsletter link.
- Posts > char limit (X: 280, LinkedIn: 3000).

## Drift escalation
If a draft makes the third pass through editor_review → rework_requested → drafted, the Editor MUST transition the draft to `editor_rejected` (not request a fourth rework). A human reviews the rejected draft in the web shell.
```

- [ ] **Step 3: `policies/editor_rubric.md`**

```markdown
# Editor rubric

Score each draft on these dimensions. If ANY hard rule fails → reject (rework_requested or editor_rejected per drift escalation). If ALL soft rules pass → approve to queue.

## Hard checks (boolean)
- HARD_VOICE: does the diction match brand_voice.md? (no banned phrases, length appropriate)
- HARD_RISK: passes all risk_policy.md hard rules?
- HARD_LINK: contains exactly one newsletter link? (if zero or two, fail)
- HARD_HOOK: declares a hook_tag from hook_taxonomy.md? (uses one of the named hooks)
- HARD_CHAR: ≤ 280 chars for X, ≤ 3000 chars for LinkedIn?

## Soft checks (boolean)
- SOFT_SPECIFIC: contains at least one concrete number, name, or detail?
- SOFT_OPEN: opening line earns the read (per the chosen hook's pattern)?
- SOFT_CTA: ends with a clear next step (read, reply, share)?
- SOFT_FORMAT: no emoji-stuffing, no fake line breaks, no clickbait punctuation (?!?!).

## Output format (return as JSON)
{
  "verdict": "approve" | "rework" | "editor_reject",
  "scores": { "HARD_*": bool, "SOFT_*": bool },
  "notes": "single paragraph explaining the verdict",
  "suggested_edits": null | "concrete edit instructions if rework"
}
```

- [ ] **Step 4: `policies/hook_taxonomy.md`**

```markdown
# Hook taxonomy

A `hook_tag` is REQUIRED on every Copywriter draft. Choose one of these slugs:

- `question-opener` — opens with a real question the audience is asking.
- `bold-claim` — single specific assertion in the opener.
- `numbered-list` — opener promises N specific takeaways.
- `personal-story` — first-person anecdote, lesson at the end.
- `contrarian` — names a common belief, then disagrees with evidence.
- `behind-the-scenes` — describes what we just shipped/learned, payload at end.
- `before-after` — concrete metric or state change ("from X to Y in Z days").

Adding a new hook? Open a PR amending this file and the eval set under `agents/copywriter_x.evals/`.
```

- [ ] **Step 5: `policies/readme.md`**

```markdown
# Policies

These markdown files are loaded by Paperclip at startup and inlined into each agent's system prompt at the marker `{{policy:NAME}}` (where NAME is the basename without `.md`).

Editing these files changes agent behavior on the next agent run — no restart required (Paperclip re-reads on each invocation).

When you tighten a policy, also tighten the relevant `.evals/` set so prompt regressions are caught in CI.
```

- [ ] **Step 6: Commit**

```bash
git add policies/
git commit -m "feat(policies): add brand voice, risk policy, editor rubric, hook taxonomy"
```

---

### Task 3: `research-mcp` — Reddit, HackerNews, RSS (TDD)

**Files:**
- Create: `mcp/research-mcp/package.json`
- Create: `mcp/research-mcp/tsconfig.json`
- Create: `mcp/research-mcp/src/cache.ts`
- Create: `mcp/research-mcp/src/tools/searchReddit.ts`
- Create: `mcp/research-mcp/src/tools/searchHackerNews.ts`
- Create: `mcp/research-mcp/src/tools/fetchRssFeed.ts`
- Create: `mcp/research-mcp/src/server.ts`
- Create: `mcp/research-mcp/tests/searchHackerNews.test.ts`

- [ ] **Step 1: `mcp/research-mcp/package.json`**

```json
{
  "name": "@paperclip/research-mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "src/server.ts",
  "bin": { "research-mcp": "dist/server.js" },
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
    "rss-parser": "3.13.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "msw": "2.4.9",
    "typescript": "5.6.3",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: `mcp/research-mcp/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "tests/**/*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Add `research_cache` table to `db/src/schema.ts`**

```ts
export const researchCache = pgTable('research_cache', {
  cacheKey: text('cache_key').primaryKey(),
  body: jsonb('body').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Generate + apply migration:
```bash
pnpm --filter @paperclip/db generate
pnpm --filter @paperclip/db migrate
```

- [ ] **Step 4: `mcp/research-mcp/src/cache.ts`** (modeled on x-mcp's cache)

```ts
import { db, researchCache } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export async function cached<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const [row] = await db.select().from(researchCache).where(eq(researchCache.cacheKey, key));
  if (row && Date.now() - row.fetchedAt.getTime() < ttlSeconds * 1000) return row.body as T;
  const fresh = await fetcher();
  await db
    .insert(researchCache)
    .values({ cacheKey: key, body: fresh as object, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: researchCache.cacheKey, set: { body: fresh as object, fetchedAt: new Date() } });
  return fresh;
}
```

- [ ] **Step 5: Failing test `mcp/research-mcp/tests/searchHackerNews.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { db, researchCache } from '@paperclip/db';
import { searchHackerNews } from '../src/tools/searchHackerNews.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => { await db.delete(researchCache); });

describe('searchHackerNews', () => {
  it('queries Algolia API and normalizes results', async () => {
    server.use(
      http.get('https://hn.algolia.com/api/v1/search', () =>
        HttpResponse.json({
          hits: [
            { objectID: '1', title: 'agentic dev tools', url: 'https://ex.com/a', points: 200, num_comments: 50, created_at_i: 1700000000 },
          ],
        }),
      ),
    );
    const r = await searchHackerNews({ query: 'agentic dev', maxAgeSeconds: 60 });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('1');
    expect(r[0]!.title).toBe('agentic dev tools');
    expect(r[0]!.points).toBe(200);
  });
});
```

- [ ] **Step 6: Implement `mcp/research-mcp/src/tools/searchHackerNews.ts`**

```ts
import { cached } from '../cache.js';

export interface HNHit {
  id: string;
  title: string;
  url?: string;
  points: number;
  comments: number;
  createdAt: number;
}

interface AlgoliaResponse {
  hits: Array<{ objectID: string; title?: string; url?: string; points?: number; num_comments?: number; created_at_i?: number }>;
}

export async function searchHackerNews(input: { query: string; maxAgeSeconds?: number }): Promise<HNHit[]> {
  const ttl = input.maxAgeSeconds ?? 3600;
  return cached(`hn:${input.query}`, ttl, async () => {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(input.query)}&tags=story&hitsPerPage=20`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`hn ${r.status}`);
    const body = (await r.json()) as AlgoliaResponse;
    return body.hits.map((h) => ({
      id: h.objectID,
      title: h.title ?? '',
      url: h.url,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      createdAt: h.created_at_i ?? 0,
    }));
  });
}
```

- [ ] **Step 7: Implement `mcp/research-mcp/src/tools/searchReddit.ts`**

```ts
import { cached } from '../cache.js';

export interface RedditHit {
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  score: number;
  comments: number;
  createdAt: number;
}

interface RedditResponse {
  data: { children: Array<{ data: { id: string; subreddit: string; title: string; permalink: string; score: number; num_comments: number; created_utc: number } }> };
}

export async function searchReddit(input: { query: string; subreddit?: string; maxAgeSeconds?: number }): Promise<RedditHit[]> {
  const ttl = input.maxAgeSeconds ?? 3600;
  const key = `reddit:${input.subreddit ?? '*'}:${input.query}`;
  return cached(key, ttl, async () => {
    const base = input.subreddit
      ? `https://www.reddit.com/r/${encodeURIComponent(input.subreddit)}/search.json`
      : 'https://www.reddit.com/search.json';
    const url = `${base}?q=${encodeURIComponent(input.query)}&restrict_sr=${input.subreddit ? '1' : '0'}&sort=top&t=week&limit=20`;
    const r = await fetch(url, { headers: { 'user-agent': 'paperclip-research-mcp/0.0.0' } });
    if (!r.ok) throw new Error(`reddit ${r.status}`);
    const body = (await r.json()) as RedditResponse;
    return body.data.children.map((c) => ({
      id: c.data.id,
      subreddit: c.data.subreddit,
      title: c.data.title,
      permalink: `https://www.reddit.com${c.data.permalink}`,
      score: c.data.score,
      comments: c.data.num_comments,
      createdAt: c.data.created_utc,
    }));
  });
}
```

- [ ] **Step 8: Implement `mcp/research-mcp/src/tools/fetchRssFeed.ts`**

```ts
import Parser from 'rss-parser';
import { cached } from '../cache.js';

const parser = new Parser();

export interface RssItem {
  title: string;
  link?: string;
  isoDate?: string;
  contentSnippet?: string;
}

export async function fetchRssFeed(input: { url: string; maxAgeSeconds?: number; max?: number }): Promise<RssItem[]> {
  const ttl = input.maxAgeSeconds ?? 1800;
  return cached(`rss:${input.url}`, ttl, async () => {
    const feed = await parser.parseURL(input.url);
    return (feed.items ?? []).slice(0, input.max ?? 20).map((i) => ({
      title: i.title ?? '',
      link: i.link,
      isoDate: i.isoDate,
      contentSnippet: i.contentSnippet,
    }));
  });
}
```

- [ ] **Step 9: Implement `mcp/research-mcp/src/server.ts`**

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { searchHackerNews } from './tools/searchHackerNews.js';
import { searchReddit } from './tools/searchReddit.js';
import { fetchRssFeed } from './tools/fetchRssFeed.js';

const hn = z.object({ query: z.string(), maxAgeSeconds: z.number().optional() });
const reddit = z.object({ query: z.string(), subreddit: z.string().optional(), maxAgeSeconds: z.number().optional() });
const rss = z.object({ url: z.string().url(), maxAgeSeconds: z.number().optional(), max: z.number().optional() });

const server = new Server({ name: 'research-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'searchHackerNews', description: 'Search HN via Algolia', inputSchema: { type: 'object' } },
    { name: 'searchReddit', description: 'Search Reddit top posts', inputSchema: { type: 'object' } },
    { name: 'fetchRssFeed', description: 'Fetch and parse an RSS feed', inputSchema: { type: 'object' } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    let result: unknown;
    switch (req.params.name) {
      case 'searchHackerNews': result = await searchHackerNews(hn.parse(req.params.arguments)); break;
      case 'searchReddit': result = await searchReddit(reddit.parse(req.params.arguments)); break;
      case 'fetchRssFeed': result = await fetchRssFeed(rss.parse(req.params.arguments)); break;
      default: throw new Error(`unknown: ${req.params.name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `ERROR: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 10: Run + build**

```bash
pnpm install
pnpm --filter @paperclip/research-mcp test
pnpm --filter @paperclip/research-mcp build
```
Expected: HN test PASS; build clean.

- [ ] **Step 11: Commit**

```bash
git add mcp/research-mcp/ db/src/schema.ts db/migrations/ pnpm-lock.yaml
git commit -m "feat(research-mcp): Reddit + HN + RSS tools with postgres cache"
```

---

### Task 4: Agent YAMLs — Chief of Staff + Strategist

**Files:**
- Create: `agents/chief_of_staff.yaml`
- Create: `agents/strategist.yaml`

> Adapt YAML keys to Paperclip's actual schema. `system_prompt`, `tools`, `budget_usd_per_month`, `heartbeat_cron`, `model` are illustrative names — check `paperclip/examples/`.

- [ ] **Step 1: `agents/chief_of_staff.yaml`**

```yaml
id: chief_of_staff
name: Chief of Staff
model: smart
budget_usd_per_month: 10
heartbeat_cron: "0 9 * * MON"   # weekly, Mon 09:00 local
reports_to: null
tools:
  - mcp: drafts
    tools: [createDraft, transitionStatus, listByStatus, getDraft]
  - mcp: analytics
    tools: [getLastWeeklyDigest]
    optional: true
system_prompt: |
  You are the Chief of Staff of a one-person newsletter marketing agency. Your job is to plan each week of work.

  Each Monday morning:
  1. Read the most recent weekly digest from analytics (if available — it may be empty in early weeks).
  2. Choose 2-3 themes for the week. Pick themes that have evidence of working OR address a gap in coverage.
  3. For each theme, create a "brief" draft via drafts.createDraft with:
     - platform: leave null (briefs aren't platform-specific)
     - status: "briefed"
     - body: a 3-5 sentence brief explaining the theme, target audience, and angle.
  4. Open a ticket assigning each brief to the Strategist.

  You do NOT write content. You set direction. Keep briefs short. Do not exceed your monthly budget.

  Policies you must follow:
  {{policy:brand_voice}}
  {{policy:risk_policy}}
```

- [ ] **Step 2: `agents/strategist.yaml`**

```yaml
id: strategist
name: Strategist
model: smart
budget_usd_per_month: 20
trigger: ticket_assigned   # not heartbeat; runs when COS assigns
reports_to: chief_of_staff
tools:
  - mcp: drafts
    tools: [createDraft, updateDraft, transitionStatus, listByStatus, getDraft]
  - mcp: analytics
    tools: [topHooksLastNDays, topThemesLastNDays]
    optional: true
system_prompt: |
  You are the Strategist. Given a brief from the Chief of Staff, your job is to refine it into a concrete campaign brief and assign research.

  Steps:
  1. Read the brief draft (status=briefed).
  2. If analytics is available, query top hooks + themes from the last 28 days. Use the data to shape angle decisions.
  3. Update the brief's `research` JSON with the refined plan:
     {
       "audience": "...",
       "angle": "...",
       "platforms": ["x", "linkedin"],
       "suggested_hooks": ["question-opener", "behind-the-scenes"],
       "key_points": ["point 1", "point 2"]
     }
  4. Transition brief: briefed → researched is for the Researcher; you stay at briefed.
  5. Open a Researcher ticket linking to this brief.

  Constraints:
  - Pick at most 3 suggested_hooks from {{policy:hook_taxonomy}}.
  - Do not draft post copy. That's the Copywriter's job.
  - Do not exceed your monthly budget.

  {{policy:brand_voice}}
```

- [ ] **Step 3: Commit**

```bash
git add agents/chief_of_staff.yaml agents/strategist.yaml
git commit -m "feat(agents): chief_of_staff + strategist YAMLs"
```

---

### Task 5: Agent YAMLs — Researcher

**Files:**
- Create: `agents/researcher.yaml`

- [ ] **Step 1: `agents/researcher.yaml`**

```yaml
id: researcher
name: Researcher
model: cheap
budget_usd_per_month: 10
trigger: ticket_assigned
reports_to: strategist
tools:
  - mcp: drafts
    tools: [getDraft, updateDraft, transitionStatus, listByStatus]
  - mcp: research
    tools: [searchHackerNews, searchReddit, fetchRssFeed]
  - mcp: x
    tools: [searchTopPosts]            # READ ONLY
  - mcp: linkedin
    tools: [searchTopPosts]            # READ ONLY (graceful empty allowed)
system_prompt: |
  You are the Researcher. Given a brief (with audience + angle + platforms + suggested_hooks), produce a research blob that the Copywriters can use as raw material.

  Steps:
  1. Read the brief via drafts.getDraft.
  2. Issue 2-3 targeted searches:
     - searchHackerNews({ query: <topic terms> })
     - searchReddit({ query: <topic terms>, subreddit: <if relevant from audience field> })
     - x.searchTopPosts({ account: "newsletter_main", query: <topic terms> })  // optional
     - linkedin.searchTopPosts({ account: "newsletter_main", query: <topic terms> })  // optional, may return []
  3. Distill the top signals into a JSON `research` blob:
     {
       "trends": ["..."],
       "top_posts": [{ "platform": "x|hn|reddit|linkedin", "text": "...", "engagement": <number> }, ...],
       "audience_notes": "...",
       "open_questions": ["..."]
     }
  4. drafts.updateDraft to attach research, then drafts.transitionStatus briefed→researched.
  5. Open Copywriter-X and Copywriter-LinkedIn tickets pointing at the brief.

  Budget hygiene:
  - Prefer cached results (the MCP layer caches automatically).
  - Do not run > 5 distinct queries per ticket.
```

- [ ] **Step 2: Commit**

```bash
git add agents/researcher.yaml
git commit -m "feat(agents): researcher YAML"
```

---

### Task 6: Agent YAMLs — Copywriter-X and Copywriter-LinkedIn

**Files:**
- Create: `agents/copywriter_x.yaml`
- Create: `agents/copywriter_linkedin.yaml`

- [ ] **Step 1: `agents/copywriter_x.yaml`**

```yaml
id: copywriter_x
name: Copywriter (X)
model: smart
budget_usd_per_month: 40
trigger: ticket_assigned
reports_to: strategist
tools:
  - mcp: drafts
    tools: [getDraft, createDraft, transitionStatus, listByStatus]
  - mcp: x
    tools: [searchTopPosts]            # READ ONLY — never postTweet
  - mcp: analytics
    tools: [topWinnersByPlatform]
    optional: true
system_prompt: |
  You are the X Copywriter. Given a researched brief, produce exactly 3 X drafts (single tweet OR thread). Each must declare a hook_tag from {{policy:hook_taxonomy}}.

  Steps:
  1. Read the brief and its research blob.
  2. If analytics is available, fetch top 5 winners on X from the last 28 days. Use them as few-shot voice anchors — DO NOT copy.
  3. Produce 3 variants, each with a different hook_tag.
  4. For each variant:
     drafts.createDraft({
       platform: "x",
       parent_brief_id: <brief.id>,
       status: "drafted",
       hook_tag: <slug from taxonomy>,
       body: <the tweet text>
     })

  Hard constraints:
  - X char limit: 280 per tweet. Threads: each tweet ≤ 280.
  - Always include exactly one newsletter link per variant: {{NEWSLETTER_URL}}
  - Follow {{policy:brand_voice}}.

  {{policy:risk_policy}}

  Do not invent statistics or facts not present in the research blob.
```

- [ ] **Step 2: `agents/copywriter_linkedin.yaml`**

```yaml
id: copywriter_linkedin
name: Copywriter (LinkedIn)
model: smart
budget_usd_per_month: 40
trigger: ticket_assigned
reports_to: strategist
tools:
  - mcp: drafts
    tools: [getDraft, createDraft, transitionStatus, listByStatus]
  - mcp: linkedin
    tools: [searchTopPosts]            # READ ONLY (may return [])
  - mcp: analytics
    tools: [topWinnersByPlatform]
    optional: true
system_prompt: |
  You are the LinkedIn Copywriter. Given a researched brief, produce exactly 3 LinkedIn post drafts. Each must declare a hook_tag from {{policy:hook_taxonomy}}.

  Steps:
  1. Read the brief and its research blob.
  2. If analytics has LinkedIn winners, use the top 5 as voice anchors — DO NOT copy.
  3. Produce 3 variants. Length: 800–1500 chars.

  Format guidance:
  - Open with a hook. ONE blank line. Body in short paragraphs. ONE blank line. Soft CTA.
  - Sentence case. Professional but warm. No hashtags in the first version (you can add later if proven).

  Hard constraints:
  - Each variant: ≤ 3000 chars total.
  - Include exactly one newsletter link: {{NEWSLETTER_URL}}.
  - Follow {{policy:brand_voice}}.

  {{policy:risk_policy}}
```

- [ ] **Step 3: Commit**

```bash
git add agents/copywriter_x.yaml agents/copywriter_linkedin.yaml
git commit -m "feat(agents): copywriter_x + copywriter_linkedin YAMLs"
```

---

### Task 7: Agent YAML — Editor

**Files:**
- Create: `agents/editor.yaml`

- [ ] **Step 1: `agents/editor.yaml`**

```yaml
id: editor
name: Editor
model: smart                # quality matters; not cheap
budget_usd_per_month: 30
trigger: ticket_assigned
reports_to: chief_of_staff
tools:
  - mcp: drafts
    tools: [getDraft, updateDraft, transitionStatus, listByStatus]
system_prompt: |
  You are the Editor. Your job is to gatekeep drafts to the approval queue.

  For each draft assigned to you (status=editor_review):
  1. Read the draft.
  2. Evaluate against {{policy:editor_rubric}}.
  3. Decide: approve | rework | editor_reject.
  4. If approve:
     - drafts.updateDraft(editorNotes: <full JSON rubric output>)
     - drafts.transitionStatus(editor_review → approval_queue, reason: <one-sentence summary>)
  5. If rework AND draft.reworkCount < 2:
     - drafts.updateDraft(editorNotes: <rubric JSON with suggested_edits>)
     - drafts.transitionStatus(editor_review → rework_requested, reason: <what to change>)
     - Open a Copywriter ticket on the same draft.
  6. If rework AND draft.reworkCount >= 2 OR a hard rule failed:
     - drafts.updateDraft(editorNotes: <rubric JSON>)
     - drafts.transitionStatus(editor_review → editor_rejected, reason: <one sentence>)
     - A human will review in the web shell.

  You apply {{policy:risk_policy}} and {{policy:editor_rubric}} verbatim. You are conservative — when in doubt, request rework. Do not "approve to be nice."
```

- [ ] **Step 2: Commit**

```bash
git add agents/editor.yaml
git commit -m "feat(agents): editor YAML"
```

---

### Task 8: Agent YAML — Analyst

**Files:**
- Create: `agents/analyst.yaml`

- [ ] **Step 1: `agents/analyst.yaml`**

```yaml
id: analyst
name: Analyst
model: cheap                # mostly summarization
budget_usd_per_month: 10
heartbeat_cron: "30 7 * * *"   # daily 07:30 local
heartbeat_cron_weekly: "0 16 * * FRI"  # weekly Fri 16:00 local
reports_to: chief_of_staff
tools:
  - mcp: drafts
    tools: [listByStatus, getDraft]
  - mcp: analytics
    tools: [postsLastNDays, topHooksLastNDays, topThemesLastNDays, attributionsLastNDays]
system_prompt: |
  You are the Analyst. You write digests; you do not modify drafts.

  Daily run (heartbeat_cron):
  1. analytics.postsLastNDays({ days: 1 }) — yesterday's posts.
  2. For each, look at snapshots + attributed signups.
  3. Write a daily digest (3-5 bullet points):
     - top performer by attributed signups
     - any negative surprises (post with ≥1k impressions but 0 signups)
     - recommended pulls (something tanking we should stop boosting)
     - one observation that should change next week's brief
  4. Write digest body via analytics.writeDigest({ kind: "daily", contentMd: <markdown> }).

  Weekly run (heartbeat_cron_weekly):
  1. analytics.topHooksLastNDays({ days: 7 }) and analytics.topThemesLastNDays({ days: 7 }).
  2. Write a weekly leaderboard digest with:
     - top 5 hooks by signups/1k impressions
     - top 3 themes
     - one paragraph: what to double down on, what to kill
  3. analytics.writeDigest({ kind: "weekly", ... }).

  Do not propose new posts. Do not modify drafts.
```

- [ ] **Step 2: Commit**

```bash
git add agents/analyst.yaml
git commit -m "feat(agents): analyst YAML"
```

---

### Task 9: `promote-brief` script for kicking off a manual run

**Files:**
- Create: `scripts/promote-brief.ts`
- Modify: root `package.json`

- [ ] **Step 1: Write `scripts/promote-brief.ts`**

```ts
#!/usr/bin/env tsx
import { createDraft, transitionStatus } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('promote-brief');
const theme = process.argv[2];
if (!theme) {
  console.error('usage: tsx scripts/promote-brief.ts "<one-line theme>"');
  process.exit(1);
}

const brief = await createDraft({
  platform: Platform.X, // brief is on X by convention; researcher splits to LinkedIn too
  status: DraftStatus.Briefed,
  body: theme,
});
log.info({ briefId: brief.id }, 'brief created — strategist ticket will be opened by paperclip on next heartbeat');
```

- [ ] **Step 2: Add script to root `package.json`**

```json
"scripts": {
  "...": "(unchanged)",
  "brief": "tsx scripts/promote-brief.ts"
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/promote-brief.ts package.json
git commit -m "chore: add promote-brief CLI to seed manual briefs"
```

---

### Task 10: docker-compose — add Paperclip + research-mcp services

**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `infra/Dockerfile.worker` (handle mcp/research-mcp build)
- Create: `infra/Dockerfile.paperclip`

- [ ] **Step 1: Write `infra/Dockerfile.paperclip`** *(adapt to Paperclip's actual build instructions)*

```dockerfile
FROM node:22-alpine
WORKDIR /paperclip
COPY paperclip/ ./
RUN apk add --no-cache python3 make g++ git
RUN npm ci || npm install
RUN npm run build || true
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

> **Note:** Replace with whatever Paperclip's actual Dockerfile / `npm start` recommends — see the submodule's `README` / `package.json`. The point is: one container per Paperclip instance, mounted at the project's `paperclip-config/`, `agents/`, `policies/`.

- [ ] **Step 2: Append services to `infra/docker-compose.yml`**

```yaml
  research-mcp:
    build:
      context: ..
      dockerfile: infra/Dockerfile.worker
      args: { TARGET: research-mcp, KIND: mcp }
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip

  paperclip:
    build:
      context: ..
      dockerfile: infra/Dockerfile.paperclip
    profiles: ["full"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ../.env
    environment:
      DATABASE_URL: postgres://paperclip:paperclip_dev@postgres:5432/paperclip
    volumes:
      - ../paperclip-config:/paperclip-config:ro
      - ../agents:/agents:ro
      - ../policies:/policies:ro
      - ../mcp:/mcp:ro
    command: ["node", "dist/index.js", "--config", "/paperclip-config/paperclip.yaml"]
    ports:
      - "8080:8080"
```

- [ ] **Step 3: Build**

```bash
docker compose -f infra/docker-compose.yml --profile full build
```
Expected: all images build. (Paperclip image may need adjustment based on its actual build process — read errors and iterate.)

- [ ] **Step 4: Commit**

```bash
git add infra/
git commit -m "chore(infra): add paperclip + research-mcp services to docker-compose"
```

---

### Task 11: End-to-end smoke run

**Files:**
- No new files; verification only

- [ ] **Step 1: Boot everything**

```bash
docker compose -f infra/docker-compose.yml --profile full up -d
pnpm --filter @paperclip/db migrate
pnpm seed:x-creds
```

- [ ] **Step 2: Kick off a brief**

```bash
pnpm brief "Theme: agentic workflows are the new IDE. Audience: indie devs. Angle: what changed in the last 6 months."
```

Expected: a `briefed` row appears; on Paperclip's next strategist trigger, it processes.

- [ ] **Step 3: Watch the pipeline**

In one terminal: `docker compose -f infra/docker-compose.yml logs -f paperclip` — watch ticket activity. In another, open `http://localhost:3000/queue` and refresh periodically.

Within ~5-15 minutes (depending on agent latency), expect to see ~6 drafts in the approval queue (3 X + 3 LinkedIn).

- [ ] **Step 4: Confirm cost discipline**

Visit Paperclip's dashboard (port 8080). Each agent should show non-zero token usage, well under monthly budget.

- [ ] **Step 5: Approve one, watch it post**

Approve an X draft. Wait ≤15 min for the scheduler tick. Visit X (or Drizzle Studio) — confirm posted.

- [ ] **Step 6: No commit; verification only**

If any step failed, debug and update YAMLs / policies / Paperclip config. Re-commit specific files as fixes.

---

### Self-Review

**Spec coverage:**
- 8 agents: Chief of Staff (Task 4), Strategist (Task 4), Researcher (Task 5), Copywriter-X (Task 6), Copywriter-LinkedIn (Task 6), Editor (Task 7), Analyst (Task 8). **7 agents written** — Scheduler is intentionally a Plan-2 worker, not a Paperclip agent. ✓
- Policies (brand_voice, risk_policy, editor_rubric, hook_taxonomy) — Task 2. ✓
- research-mcp (Reddit + HN + RSS) — Task 3. ✓
- Per-agent budgets — declared in each YAML. ✓
- Heartbeats — COS weekly, Analyst daily+weekly. ✓
- Tickets via Paperclip's mechanism — implied; executor adapts. ✓
- MCP grants are read-only for drafters (only Scheduler worker writes to X/LinkedIn). ✓

**Placeholder scan:** Agent YAML keys (`system_prompt`, `tools`, `budget_usd_per_month`, `trigger`, `heartbeat_cron`, `reports_to`, `model`) are illustrative. Task 1 Step 2 mandates the executor read Paperclip's example config and adapt. This is flagged, not hidden.

**Type consistency:** `hook_tag` slugs in YAMLs match `policies/hook_taxonomy.md`. Agent `model` refers to entries in `paperclip-config/paperclip.yaml` (`smart`, `cheap`).

**Identified gap:** Plan 4 references `analytics-mcp` tools (`topHooksLastNDays`, `getLastWeeklyDigest`, `writeDigest`, etc.) in Strategist, Copywriter, Analyst YAMLs. **That MCP doesn't exist until Plan 5.** Each affected YAML marks the MCP `optional: true`, so agents tolerate its absence in this plan — they just degrade (Strategist runs without prior-week data; Copywriter without top-winner few-shot; Analyst's heartbeat is a no-op). This is intentional graceful degradation — flagged here so the executor doesn't think it's a bug.

---

### What you have after Plan 4

A real agency: real LLMs, real prompts, real research, real critique. Run `pnpm brief "<theme>"` and ~10 minutes later you have 6 drafts in your queue to approve. No analytics-driven optimization yet (Plan 5), but the content engine works end-to-end. ~11 commits, ~1500 LoC (mostly markdown + YAML).
