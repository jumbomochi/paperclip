# Zero-Human Marketing Agency — Design Spec

**Date:** 2026-05-26
**Owner:** Jonathan Doh
**Substrate:** [Paperclip](https://paperclip.ing/) — open-source self-hosted AI agent orchestration

---

## 1. Purpose

Build an internal AI marketing agency that grows an owned newsletter's audience on X and LinkedIn with minimal human time. The agency drafts, edits, and queues posts autonomously; a human (you) approves a one-click queue and pastes LinkedIn posts manually. The system measures what works via UTM-attributed newsletter signups and feeds those learnings back into future drafts.

This is v1 of an internal cost-center system — not a SaaS, not a multi-client agency. One operator, one newsletter, two platforms.

## 2. Goals & non-goals

**Goals:**

- Reduce human time on audience-growth marketing to **≤ 15 minutes/day** at steady state.
- Optimize for **net new newsletter subscribers attributed to social posts**, not vanity engagement.
- Provide an auditable trail for every post: who drafted it, against what brief, with what hook, and how it performed.
- Stay within published API ToS for X and LinkedIn — no scraping, no auto-engagement.

**Non-goals (v1):**

- No additional platforms (TikTok, Instagram, YouTube Shorts, Bluesky, Threads, Reddit posting). Reddit only as a research source.
- No auto-reply, auto-DM, auto-follow, or auto-engagement of any kind.
- No multi-product, multi-brand, multi-tenant, or multi-user support. Single operator.
- No image or video generation. Text only.
- No statistical A/B testing harness. Variants exist; "test" is which one ships.
- No HA / multi-region. Single VPS, single Postgres, daily backups.
- No native mobile app. PWA-friendly web is fine.

## 3. Architecture

Three layers, one Postgres.

```
                       ┌──────────────────────────┐
                       │   Web Shell (Next.js)    │
                       │  • Approval queue        │
   You ── browser ────►│  • Preview cards         │
                       │  • Analytics dashboard   │
                       └────────┬─────────────────┘
                                │ reads/writes drafts, approvals, metrics
                                ▼
                       ┌──────────────────────────┐
                       │   Postgres               │
                       │  drafts, posts, metrics, │
                       │  audiences, hooks        │
                       └────────▲─────────────────┘
                                │
                                │ same DB
                                │
   ┌──────────────────────┐     │     ┌─────────────────────────────────┐
   │  Paperclip (self-    │◄────┴────►│  MCP Servers (one per concern)  │
   │  hosted)             │  tools    │  • x-mcp        (X read+write)  │
   │  • Org chart         │           │  • linkedin-mcp (READ-ONLY)     │
   │  • Agent budgets     │           │  • research-mcp (Reddit/RSS/HN) │
   │  • Tickets / audit   │           │  • analytics-mcp(metrics ingest)│
   │  • Heartbeats        │           │  • drafts-mcp   (Postgres CRUD) │
   └──────────────────────┘           │  • attribution-mcp (webhook)    │
                                      └─────────────────────────────────┘
```

**Paperclip** owns the org chart, agents, per-agent budgets, scheduled heartbeats, and audit trail. Agents reach the outside world only via MCP tools — no direct HTTP in prompts.

**MCP servers** are thin, single-responsibility adapters. Each owns one external system or one internal concern. Blast radius for any one integration change is one package.

**Web shell** is a small Next.js app whose primary purpose is the approval queue UI. It reads/writes the same Postgres that Paperclip's agents do (via drafts-mcp on the agent side, directly on the web side).

### 3.1 Why these choices

- **Shared Postgres** between agents and web shell avoids a sync layer. Single source of truth for drafts, posts, hooks, metrics, attributions.
- **MCP for platform APIs** keeps ToS-sensitive code paths deterministic and reviewable — not LLM-generated. MCP tool calls are individually auditable in Paperclip's trail.
- **Web shell exists for one reason: approval UX.** Paperclip's generic ticket UI cannot render a tweet card, character count, or LinkedIn preview the way a daily-driver workflow needs. Everything else (replays, audit, kicking jobs) can happen in Paperclip's own UI.

## 4. Agent roles & org chart

Eight roles, scoped to one job each.

```
                  ┌─────────────────┐
                  │ Chief of Staff  │  weekly heartbeat
                  └────┬────────┬───┘
                       │        │
                       ▼        ▼
                ┌──────────┐  ┌──────────┐
                │Strategist│  │ Analyst  │  daily heartbeat
                └────┬─────┘  └──────────┘
                     │            ▲ (feeds metrics + winning-hooks digest)
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
 ┌──────────┐ ┌──────────────┐ ┌────────────────────┐
 │Researcher│ │Copywriter-X  │ │Copywriter-LinkedIn │
 └────┬─────┘ └──────┬───────┘ └──────────┬─────────┘
      │              │                     │
      └──────────────┴────────┬────────────┘
                              ▼
                       ┌──────────────┐
                       │   Editor     │  triggered by drafts-ready
                       └──────┬───────┘
                              ▼
                       ┌──────────────┐
                       │  Approval    │  human (you), via web shell
                       │   queue      │
                       └──────┬───────┘
                              ▼
                       ┌──────────────┐
                       │  Scheduler   │  hourly heartbeat (X posts; pings you for LinkedIn)
                       └──────────────┘
```

| Role | Trigger | Reads | Writes | Tools |
|---|---|---|---|---|
| Chief of Staff | Weekly heartbeat (Mon) | Analyst's weekly digest | Brief ticket to Strategist | drafts-mcp |
| Strategist | Brief ticket | Analytics + brand voice + last 4 weeks of themes | Campaign brief (1-3 themes/audiences) | analytics-mcp, drafts-mcp |
| Researcher | Theme ticket | Live web/community signals | Research brief per theme | research-mcp, x-mcp (read), linkedin-mcp (read) |
| Copywriter-X | Brief + research ticket | Voice doc, prior winners, top-5 examples | N tweet/thread drafts (each tagged with hook) | x-mcp (read), drafts-mcp |
| Copywriter-LinkedIn | Same | Same | N LinkedIn drafts (each tagged with hook) | linkedin-mcp (read), drafts-mcp |
| Editor | Drafts-ready ticket | Brand-voice + risk policy + rubric | Approve-to-queue / send-back-with-notes | drafts-mcp |
| Scheduler | Hourly heartbeat | Approved drafts ready to post, historical best-time data | Post (X) or notify human (LinkedIn); mark posted | x-mcp (write), drafts-mcp, notifier worker |
| Analyst | Daily heartbeat (AM) | Posts ≤ N days old + snapshots + attributions | Daily what's-working digest, weekly hook/theme leaderboard | analytics-mcp, drafts-mcp |

**Design decisions:**

1. **Editor is a separate agent, not copywriter self-check.** Different system prompt, rubric-driven, conservative. Self-review by the drafting prompt is unreliable.
2. **Copywriters have read-only platform access; only Scheduler writes.** A prompt-injected drafter cannot trigger a post.
3. **The approval queue is not an agent.** It's a `status` value in Postgres. Only humans (via web shell) and the Scheduler ever transition rows; no agent can promote a draft past the gate.

## 5. Post lifecycle / data flow

Every draft is a row in `drafts` with a `status` column. State transitions are the only way work moves.

```
   briefed ──► researched ──► drafted ──► editor_review
                                              │
                          ┌───────────────────┴────────┐
                          ▼                            ▼
                    rework_requested              approval_queue
                          │                            │
                          └──► drafted (loop, max 2)   │  (human gate)
                                                       ▼
                                            ┌──────────┴──────────┐
                                            ▼                     ▼
                                         rejected              approved
                                                                  │
                                          ┌───────────────────────┴───────────┐
                                          ▼                                   ▼
                                  (X) scheduled                   (LinkedIn) awaiting_paste
                                          │                                   │
                                          ▼                                   ▼
                                       posted                               posted
                                          │                                   │
                                          ▼                                   ▼
                                    measuring                              measuring
                                          │                                   │
                                          └─────────────┬─────────────────────┘
                                                        ▼
                                                    archived
```

**Walkthrough — one week:**

- **Mon 9:00** — COS heartbeat. Reads last Analyst weekly digest, opens brief ticket to Strategist.
- **Mon** — Strategist picks 2-3 themes × audiences. Creates a `drafts` row at `status=briefed` per theme. Opens research tickets.
- **Mon/Tue** — Researcher fills in `research` JSONB on each draft via research-mcp / x-mcp.read / linkedin-mcp.read. Status → `researched`.
- **Tue/Wed** — Copywriters produce N=3 variants per platform per researched draft. Each variant is a `drafts` row linked by `parent_brief_id`, tagged with `hook_tag`. Status → `drafted`.
- **Wed** — Editor runs rubric. Either → `editor_review` → `approval_queue` (with one-line rationale), or → `rework_requested` with structured notes. Max 2 rework cycles per variant; third strike → `editor_rejected`, surfaced for human override.
- **Wed onward** — You, via web shell: queue page renders preview, char count, research, Editor's rationale. Three buttons: Approve / Edit & approve / Reject.
- **Hourly** — Scheduler heartbeat: for X drafts at `status=approved` with `scheduled_for ≤ now()`, calls `x-mcp.post()`. On success: writes `platform_post_id`, status → `posted`, enqueues five snapshot jobs at +1h/+6h/+24h/+72h/+7d. For LinkedIn drafts: bumps to top of queue and notifies human (status → `awaiting_paste`).
- **You, on LinkedIn notification:** Open the post in web shell, click "Copy + open compose" (pre-fills LinkedIn's share intent), paste, post, paste resulting URL back. Status → `posted`, snapshot jobs enqueued.
- **Continuously** — metrics-collector worker drains `metrics_jobs`, writes `post_metrics_snapshots`. After +7d snapshot → status `archived`.
- **Continuously** — attribution-mcp's webhook endpoint receives newsletter signups, writes `attributions(post_id, subscriber_id, signed_up_at)` per UTM-tagged source.
- **Daily AM** — Analyst writes daily digest into `digests`. Web shell home renders the latest.
- **Fri** — Analyst writes weekly hook/theme leaderboard. Input to next Monday's COS heartbeat. Loop closes.

**Properties this gives you:**

1. **Replayable.** Every draft carries its full history with timestamps + agent IDs; Paperclip's ticket trail covers *why*, the `drafts` row covers *what happened*.
2. **No agent can post past the human gate.** Only Scheduler reads `approved`; only humans (web shell) and Scheduler write `approved`.
3. **Bounded compute.** Loops have caps; heartbeats are fixed; per-agent monthly budgets are the final safety net.

## 6. Performance analytics

Four-part capability, not one agent's job.

**6.1 Collection infrastructure (deterministic code).** A `metrics-collector` worker drains a `metrics_jobs` table. Scheduler enqueues five jobs per post (+1h, +6h, +24h, +72h, +7d). Each job writes one row to `post_metrics_snapshots`. Single reads miss slow-burn winners; multiple snapshots reveal them.

**6.2 Attribution.** This is the part most setups skip.

- Every link in a draft is rewritten by drafts-mcp before posting to a short URL with `?utm_source={x|linkedin}&utm_medium=social&utm_campaign=post_{id}&utm_content={hook_tag}`.
- Newsletter platform (Substack/Beehiiv/Kit/ConvertKit/Ghost) sends a signup webhook to attribution-mcp.
- attribution-mcp parses UTM, writes `(post_id, subscriber_id, signed_up_at)` to `attributions`.
- Daily reconciliation poll against newsletter platform API catches any missed webhook events.

**6.3 Data model.**

```
posts(id, draft_id, platform, platform_post_id, posted_at, ...)
post_metrics_snapshots(id, post_id, captured_at, impressions, engagement, ...)
hooks(id, slug, description)
post_hooks(post_id, hook_id)            -- M2M
themes(id, slug, brief_summary)
attributions(post_id, subscriber_id, signed_up_at, utm_payload)
digests(id, kind: daily|weekly, content_md, created_at)
```

Hooks and themes are declared at draft-time by the Copywriter (`hook_tag` is required field on every draft). This makes leaderboards trivial later.

**6.4 The Analyst agent.** Thin and focused: interprets, doesn't compute.

- **Daily digest:** yesterday's posts, surprises, pull recommendations.
- **Weekly leaderboard:** hooks + themes ranked by net-new-subscribers per impression. Goes to COS heartbeat as input.
- **Few-shot feedback:** top-5 winners per format surfaced to Copywriters when they draft.

**6.5 Web shell views.**

- Per-post detail: snapshot timeline chart, attributed subscribers, hook/theme tags.
- Leaderboards: hooks, themes, formats, times-of-day.
- Conversion funnel: impressions → clicks → signups, per channel.

## 7. External integrations & risk

### 7.1 X (Twitter)

- **Tier:** Basic ($200/mo). Free doesn't allow posting; Pro is overkill.
- **Post limit:** ~3,000/month — far more than needed at cap of 4/day.
- **Read limit:** ~10k/month — the *real* constraint. Researcher and Analyst must cache reads in Postgres, batch lookups, prefer "what we already know."
- **Auth:** OAuth 2.0 PKCE per account. Tokens encrypted at rest, resolved by x-mcp at call-time, never enter prompts or tool arguments.

### 7.2 LinkedIn — read-only

LinkedIn does not grant background-posting access to personal profiles to non-partner apps. Rather than fight that, linkedin-mcp is **read-only**.

- **Posting path:** approval queue → `awaiting_paste` → human paste via "Copy + open compose" deep link → human pastes resulting URL back → `posted`.
- **No API write access required**, no partner application, no rate-limit-on-write risk, no ToS-on-write risk.
- **Read scope** used for research and metrics is limited too; what's not available via API is acceptably lost.

### 7.3 Newsletter platform (attribution)

- Pick one of Substack / Beehiiv / Kit / ConvertKit / Ghost during implementation.
- All offer signup webhooks; if the chosen one doesn't, fall back to API polling every 5 min.
- attribution-mcp owns the webhook endpoint.

### 7.4 Research sources

- X / LinkedIn for "what's working in space": official APIs only via x-mcp / linkedin-mcp read paths.
- Reddit, HN, RSS: official APIs and RSS.
- No headless-browser scraping.

### 7.5 ToS hygiene (system-wide rules)

- Cadence cap per day per platform (default: X=4, LinkedIn=1). Enforced in Scheduler before any write.
- Schedule jitter ±5-15 min — no `:00` cluster.
- No auto-reply, auto-DM, auto-follow, auto-engagement in v1.
- One account per platform.

### 7.6 Secrets

- All OAuth tokens encrypted at rest (pgsodium or equivalent).
- Tokens never enter agent prompts or tool arguments. MCP tools take logical `account: "newsletter_main"`; server resolves internally.
- Paperclip audit captures agent → tool → account label → result summary. Token values never logged.

### 7.7 Risk-graded failure modes

| Failure | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| X API price hike / rate cut | Medium | Cost spike | Aggressive read caching; throttle Researcher |
| Editor + Copywriter loop unbounded | Low | Token burn | Hard cap (2 cycles) + Paperclip per-agent budgets |
| Prompt injection in research → unwanted post | Low | Reputational | Editor + human queue gate (two-layer defense) |
| X account suspension for bot-like patterns | Low | Lose channel | Cadence cap, jitter, no auto-engagement, one account |
| Attribution webhook misses signups | Medium | Bad metrics → bad strategy | Daily reconciliation poll against newsletter API |
| Human forgets to paste LinkedIn post | High | Missed publication | Notifier worker re-pings after T minutes; web shell shows stale `awaiting_paste` count prominently |

## 8. Repository layout & tech choices

```
paperclip/
├── paperclip/                     # vendored / cloned upstream (submodule)
├── apps/
│   └── web/                       # Next.js 15, App Router, shadcn/ui
│       ├── app/
│       │   ├── queue/             # approval queue (your daily driver)
│       │   ├── posts/[id]/        # per-post detail + snapshot chart
│       │   ├── leaderboards/      # hooks, themes, formats
│       │   └── digests/           # Analyst's daily/weekly digests
│       └── lib/
├── mcp/                           # one package per MCP server
│   ├── x-mcp/                     # X read + write
│   ├── linkedin-mcp/              # LinkedIn READ-ONLY
│   ├── research-mcp/              # Reddit, RSS, HN
│   ├── analytics-mcp/             # snapshot queries, leaderboards
│   ├── drafts-mcp/                # Postgres CRUD for drafts/posts/hooks
│   └── attribution-mcp/           # newsletter webhook + UTM rewriting
├── workers/
│   ├── metrics-collector/         # drains metrics_jobs table
│   └── notifier/                  # pings you for awaiting_paste LinkedIn drafts
├── agents/                        # Paperclip agent configs (YAML/JSON)
│   ├── chief_of_staff.yaml
│   ├── strategist.yaml
│   ├── researcher.yaml
│   ├── copywriter_x.yaml
│   ├── copywriter_linkedin.yaml
│   ├── editor.yaml
│   ├── scheduler.yaml
│   └── analyst.yaml
├── policies/
│   ├── brand_voice.md
│   ├── risk_policy.md
│   └── editor_rubric.md
├── db/
│   └── migrations/                # SQL migrations
├── infra/
│   └── docker-compose.yml         # Paperclip + Postgres + MCPs + workers + web
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-26-zero-human-marketing-agency-design.md
```

**Tech:**

- **TypeScript** for web, MCP servers, workers. One language, shared types for the drafts schema.
- **Postgres only.** No Redis, no separate queue broker. `metrics_jobs` is a Postgres table polled by the worker.
- **MCP** stdio over JSON-RPC; Paperclip launches each MCP as a subprocess per its existing integration model.
- **Drizzle ORM** for typed DB access shared across web + MCP servers.
- **Docker Compose** for local + first deploy. K8s only if scale demands.

## 9. Testing strategy

Three layers, each with a different job.

**9.1 Deterministic code.**

- MCP servers: contract tests per tool — given args X, returns shape Y, makes API call Z (HTTP mocked via msw / nock).
- Workers: snapshot-collector tested against a fake clock; verify five jobs enqueued at correct offsets.
- Web shell: Playwright on the queue → approve → status-transition flow.
- DB: migrations run forward + back in CI; state-machine constraint tests (can't skip from `briefed` to `posted`).

**9.2 Agent prompts: golden-set evals.**

- Each agent has a versioned eval directory (e.g., `agents/copywriter_x.evals/`) with ~20 canned inputs (briefs + research) and expected-property assertions: `includes hook_tag`, `≤ 280 chars`, `no banned phrase from risk policy`, `cites at least one few-shot example`.
- Replay-mode evals (recorded LLM) run on every PR — fast, free.
- Live-mode evals run nightly to catch model drift.
- Use **promptfoo** or **inspect-ai**; do not build a custom harness.
- Promotion criterion: `pass_rate ≥ 95%` on the eval set, judged by a separate **eval-judge** prompt (different model, rubric-driven). Not the same model that drafted.

**9.3 End-to-end: shadow weeks in staging.**

- Staging deployment points at a throwaway X dev account and a private newsletter list.
- For 1 week before each major prompt change ships, drafts post to staging. Human review of the queue catches integration drift the lower layers miss.

**What we don't test:**

- "Does the Strategist pick the *right* themes?" That's a quality judgment, measured via the production feedback loop (attributed signups per theme), not in CI.

## 10. Out of scope (v1)

- Other platforms (TikTok, Instagram, YouTube Shorts, Bluesky, Threads). Reddit only as a research source.
- Auto-reply, auto-DM, auto-follow, auto-engagement of any kind.
- Multi-product, multi-brand, multi-tenant, multi-user.
- Image / video generation. Text only.
- A/B testing harness with statistical rigor.
- Live trend dashboards (daily/weekly digests are enough).
- Reply-suggestions queue / mention-handling.
- HA / multi-region. Single VPS, single Postgres, daily backups.
- Native mobile app.

## 11. Success criteria

v1 ships when:

1. A draft can travel briefed → researched → drafted → edited → approved → posted (X) and briefed → … → posted (LinkedIn via manual paste) end-to-end without intervention beyond the queue gate.
2. Attribution: a UTM-tagged link in a post becomes a row in `attributions` when a subscriber signs up via that link.
3. The web shell renders: today's queue, a per-post detail with snapshot timeline, hook + theme leaderboards, and the latest Analyst digest.
4. Per-agent token budgets in Paperclip enforce: agency stops drafting if monthly cap reached.
5. Daily human time at steady state ≤ 15 minutes (measured by 1 week of self-tracking after week 1 stabilization).

## 12. Open questions / deferred decisions

- **Which newsletter platform?** Decide before implementation; affects attribution-mcp.
- **LLM mix per agent.** Editor and Analyst can run on a cheaper model (Haiku-tier) — Copywriter and Strategist on a smarter one (Sonnet/Opus). Confirm during agent eval setup.
- **Hook taxonomy.** Initial seed list to define before Copywriter eval: e.g., `question-opener`, `bold-claim`, `numbered-list`, `personal-story`, `contrarian`, `behind-the-scenes`. Will evolve as the system learns.
- **Brand voice doc length.** Aim for ~500-1000 words; refine after first 2 weeks of outputs.
