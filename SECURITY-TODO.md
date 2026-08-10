# Security TODO

> Original scan 2026-08-08 after CSA advisory
> [AD-2026-009](https://www.csa.gov.sg/alerts-and-advisories/advisories/ad-2026-009/)
> (ChainDrop / Shai-Hulud npm supply-chain attack). Lockfile scan found no
> ChainDrop-compromised packages; the items below are ordinary CVEs.

## Status

`pnpm audit`: **24 vulnerabilities** (0 critical, 9 high, 14 moderate, 1 low)
— down from 104 (4 critical, 29 high, 64 moderate, 7 low).

Patched in this pass:

- `next` 15.0.3 → 15.5.23 (kills RCE flight-protocol + middleware auth-bypass criticals)
- `react` / `react-dom` 19.0.0-rc → 19.2.8 (required by next 15.5)
- `@types/react` 18 → 19 (matches runtime)
- `recharts` 2.13.0 → 2.15.4 (react 19 peer)
- `@playwright/test` 1.48.2 → 1.62.1 (next 15.5 peer)
- `vitest` 2.1.3 → 3.2.7 (kills 2 vitest criticals; RCE-via-malicious-site + UI-server file-read)
- `@modelcontextprotocol/sdk` 1.0.4 → 1.30.0 (kills DNS-rebinding high; only stdio transport in use, so limited exploit surface)
- `zod` 3.23.8 → 3.25.76 (MCP SDK peer)
- `hono` 4.6.5 → 4.13.1 (kills 5 hono highs in attribution-mcp webhook path)
- `@hono/node-server` 1.13.4 → 1.19.17 (kills authorization-bypass high)
- `postcss` 8.4.47 → 8.5.26 (kills path-traversal high in apps/web autoprefixer chain)

All 74 tests still pass; `pnpm --filter @paperclip/web build` green.

## Remaining

### Direct-dep majors (need call — not auto-patched)

- **`drizzle-orm` 0.36.0 → 0.45.2+** (SQL injection via improperly escaped identifiers, high).
  Pre-1.0 → real risk of breaking-change surface across every query in `db/src/schema.ts`
  and every ORM call site. Recommended: bump on a dedicated branch, run the full suite,
  eyeball generated migrations before merge.
- **`nodemailer` 6.9.16 → 7.0.11+** (two highs: file-access bypass, addressparser DoS).
  Only used by `workers/notifier`, which is not yet wired to real SMTP in prod
  (`NOTIFIER_TRANSPORT=console` default). Bump when transport is enabled;
  breaking-change scope is small (mostly ESM/TS types).

### Transitive (bundled by upstream, cannot fix without upstream release)

- `sharp` 0.34.5 — bundled by `next@15.5.23`; needs next to release with sharp 0.35+.
- `postcss` 8.4.31 + `nanoid` 3.3.12 — bundled by `next@15.5.23`; same as sharp.
- `vite` 5.4.21 — bundled by `vitest@3.2.7`. Vitest 4 ships vite 6+. Untried here;
  worth attempting the 3→4 bump when someone has a clear day for it.

### Moderate/low

14 moderate, 1 low remain — mostly the same transitive chains (next-bundled postcss/nanoid variants) plus a hono low-severity JWT numeric-date-claim validation issue that's fixed by bumping to 4.12.18+ … which we already did (4.13.1). Re-run `pnpm audit` after any dep pass to see if anything's stale.
