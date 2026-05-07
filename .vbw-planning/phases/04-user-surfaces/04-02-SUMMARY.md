---
phase: 04
plan: 04-02
title: F5 — marketplace-aware `swt update`
status: complete
completed: 2026-05-07
tasks_completed: 4
tasks_total: 4
commit_hashes:
  - b801522
deviations:
  - "Plan 04-02 originally listed `packages/core/src/config/Config.ts` and CLI source/test files but did not list `packages/cli/package.json`. Adding the `zod` runtime dep was required because the CLI (under pnpm-strict) needs to declare zod directly when its source imports `from 'zod'` (same class as Plan 02-03's methodology zod-dep fix and Plan 03-01's claude-code-driver zod-dep addition). Plan-amendment: amended files_modified to include the package.json before adding the dep."
pre_existing_issues: []
ac_results:
  - criterion: "ConfigSchema has a `marketplace` block with `endpoint?: string` and `cache_ttl_hours?: number` (both optional, default null/undefined → marketplace lookup disabled)"
    verdict: "pass"
    evidence: "Config.ts adds `marketplace: z.object({endpoint: z.string().url().optional(), cache_ttl_hours: z.number().int().positive().default(24)}).optional()` in ConfigSchema. parseConfig with no marketplace key succeeds (block is optional); parseConfig({marketplace: {endpoint: 'not-a-url'}}) throws ZodError."
  - criterion: "the swt CLI's update command queries the marketplace endpoint when config.marketplace.endpoint is set, alongside the existing npm-registry query"
    verdict: "pass"
    evidence: "update.ts reads config.marketplace.endpoint via loadSwtConfig (Phase 02 helper) or accepts the test-seam `marketplaceEndpoint` opt. When set, queryMarketplaceVersion runs after the npm query. update.test.ts case `marketplace endpoint configured + same version → annotation` asserts the additional query fires and the marketplace version appears in stdout."
  - criterion: "marketplace lookup is graceful: when endpoint is not set OR returns non-2xx, the command still succeeds via the npm-registry path"
    verdict: "pass"
    evidence: "update.test.ts case `marketplace endpoint missing → npm-only path runs unchanged` asserts `payload.marketplace` is undefined when endpoint is null. marketplace-registry.test.ts case `non-2xx response → MarketplaceQueryError thrown` confirms the error type; the update handler catches MarketplaceQueryError and writes a debug warning to stderr without affecting the npm result."
  - criterion: "the marketplace-registry helper is a pure async function with the same shape as queryLatestVersion in lib/npm-registry.ts"
    verdict: "pass"
    evidence: "lib/marketplace-registry.ts exports queryMarketplaceVersion(opts: MarketplaceQueryOptions): Promise<MarketplaceVersion>. Same shape: opts has fetchImpl, cachePath, now, noCache. Same behavior: cache check → fetch → cache write → return. Independent of npm-registry; both can run via Promise.allSettled in update.ts."
  - criterion: "marketplace-listed version + npm-published version are reported separately when both are queried; user-facing output flags any divergence"
    verdict: "pass"
    evidence: "update.test.ts case `marketplace returns different version → divergence warning` asserts the stdout contains `Marketplace version (v0.2.5) differs from npm (v0.2.0)`. JSON output includes a `marketplace` field with both `version` and `fromCache` when the query succeeded."
  - criterion: "no real marketplace endpoint URL is hardcoded — the default published config is `marketplace: undefined`, leaving the lookup dormant"
    verdict: "pass"
    evidence: "ConfigSchema's marketplace block is `.optional()` (no default). DEFAULT_CONFIG produced by `ConfigSchema.parse({})` has `marketplace: undefined`. update.ts skips the marketplace query when endpoint is undefined. Tests inject endpoints explicitly via the marketplaceEndpoint opt."
---

`swt update` now supports marketplace-alongside-npm queries with structural support. Default behavior is unchanged (npm-only); when users set `config.marketplace.endpoint`, the additional query path activates.

## What Was Built

- **`packages/core/src/config/Config.ts`** — adds optional `marketplace: { endpoint?, cache_ttl_hours }` block to `ConfigSchema`.
- **`packages/cli/src/lib/marketplace-registry.ts`** — `queryMarketplaceVersion(opts)` async helper with cache + fetch + Zod validation; `MarketplaceQueryError` typed exception; `defaultMarketplaceCachePath()` for the on-disk cache location (`~/.swt/marketplace-cache.json`).
- **`packages/cli/src/commands/update.ts`** — extended `updateHandler` to read `config.marketplace.endpoint` via `loadSwtConfig`, accept a `--no-marketplace` CLI flag + a test-seam `marketplaceEndpoint` opt, and run the marketplace query in parallel with the npm query when configured. Output augmented with annotation (same version) / divergence warning (different version) / debug stderr (error). JSON output gains a `marketplace` field.
- **`packages/cli/package.json`** — adds `zod@^3.23.8` runtime dep (required because `marketplace-registry.ts` imports zod directly).
- **8 new test cases** (5 marketplace-registry + 3 update integration).

## Files Modified

- `packages/core/src/config/Config.ts` (marketplace block)
- `packages/cli/package.json` (zod dep — see deviation #1)
- `packages/cli/src/commands/update.ts` (marketplace integration)
- `packages/cli/src/lib/marketplace-registry.ts` (new — 130 LOC)
- `packages/cli/test/lib/marketplace-registry.test.ts` (new — 5 cases)
- `packages/cli/test/commands/update.test.ts` (existing 8 cases + 3 new)

## Deviations

See frontmatter `deviations:`. One:

1. **package.json amendment for zod (plan-amendment)** — same class as Plans 02-03 / 03-01's missing-zod fixes. files_modified amended to include the manifest before the dep was added.

## Verification

1. ✅ `pnpm vitest run packages/cli/test/lib/marketplace-registry.test.ts packages/cli/test/commands/update.test.ts` — 16/16 pass (5 + 11)
2. ✅ Default behavior unchanged: `swt update` with no marketplace config queries only npm
3. ✅ With `marketplace.endpoint` set in config (or test seam), the command queries both registries and surfaces the marketplace version

## Next

Plan 04-03 (F8 HttpSender) is the last plan in Phase 04. Independent of this plan; ready to ship.
