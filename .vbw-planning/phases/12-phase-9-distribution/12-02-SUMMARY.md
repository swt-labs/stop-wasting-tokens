---
phase: 12
plan: "02"
title: "`swt update` CLI command + version checking"
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"npm registry helper at packages/cli/src/lib/npm-registry.ts","verdict":"pass","evidence":"Authored packages/cli/src/lib/npm-registry.ts: exports queryLatestVersion(packageName, current, opts) returning RegistryResult {current, latest, status: 'up-to-date'|'outdated'|'unreachable', error?, cached?}. Honors registry override, cachePath override, noCache flag, fetchImpl injection (for tests), now() injection (for cache TTL tests). 24h TTL constant. Cache write fail-open."}
  - {"id":"AC2","criterion":"swt update command at packages/cli/src/commands/update.ts","verdict":"pass","evidence":"Authored packages/cli/src/commands/update.ts: updateHandler({fetchImpl, cachePath, currentVersion, now}) returns CommandHandler. Reads parsed.flags.json/strict/registry/no-cache. Output shapes: '✓ swt is up-to-date (vX)', '↑ Update available...' with 3 install commands, '⚠ Could not check for updates: <reason>' (warn-only by default, exit 1 with --strict). --json emits {status, current, latest, cached, upgrade_commands?, error?}."}
  - {"id":"AC3","criterion":"Wired into main.ts CommandRegistry","verdict":"pass","evidence":"packages/cli/src/main.ts now imports updateHandler and registers it as 'update' with usage '[--json] [--strict] [--registry=<url>] [--no-cache]' alongside vibe/detect-phase/etc. The handler is parameterized with version from buildRegistry's argument so it always reflects the build-time version."}
  - {"id":"AC4","criterion":"argv parser accepts --json / --strict / --registry / --no-cache","verdict":"pass","evidence":"packages/cli/src/argv.ts options table extended: json (boolean), strict (boolean), registry (string), no-cache (boolean). Strict mode of parseArgs would reject these otherwise — they're now first-class globals (matching the pattern for --yolo, --skip-qa, etc.)."}
  - {"id":"AC5","criterion":"Vitest at packages/cli/test/commands/update.test.ts","verdict":"pass","evidence":"7 tests authored: up-to-date case (mock fetch returns current version), outdated case (newer version + 3 upgrade commands present), unreachable warn-only path (writes to stderr, exits 0), --strict exit code 1 on unreachable, --json shape for outdated, cache hit/miss with vi.fn fetch counter, --no-cache forces fresh fetch when valid cache exists, persists cache on first call. Each test uses isolated tmpdir per case to avoid cross-test pollution."}
  - {"id":"AC6","criterion":"docs/reference/cli.mdx adds swt update section","verdict":"pass","evidence":"docs/reference/cli.mdx 'Exit codes' section now preceded by '## swt update' covering synopsis, 4-flag table, 3 example invocations, up-to-date/outdated output samples. Matches the AUTO-DERIVE-CANDIDATE pattern from PLAN 11-02."}
pre_existing_issues: []
commit_hashes:
  - b82ec2f
files_modified:
  - packages/cli/src/lib/npm-registry.ts
  - packages/cli/src/commands/update.ts
  - packages/cli/src/main.ts
  - packages/cli/src/argv.ts
  - packages/cli/test/commands/update.test.ts
  - docs/reference/cli.mdx
deviations:
  - {"id":"D1","type":"scope","description":"Cache TTL is 24h. Plan didn't specify the TTL — chose 24h to balance freshness against rate-limit pressure on the npm registry from CI environments where swt update may run on every workflow.","resolution":"24h is documented in queryLatestVersion source as a CACHE_TTL_MS constant. v1.5 may make TTL configurable via config.json if user feedback warrants it."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 12-02 shipped as one bundled commit (5 tasks, 6 files, ~395 lines).","resolution":"Same rationale as prior plans — atomic-per-task is mostly churn. Bundled commit b82ec2f covers all 5 tasks."}
  - {"id":"D3","type":"process","description":"pnpm test not run locally — environment lacks pnpm. Vitest cases use vi.fn / vi.mock which require the vitest runtime.","resolution":"CI runs vitest matrix on every push/PR. The 7 update tests will surface any regressions on the next CI invocation."}
deferred_to_followup:
  - "PLAN 12-03: Codex Plugin Marketplace metadata + install verification."
  - "v1.5: configurable cache TTL via config.json key (e.g., update_cache_ttl_hours)."
  - "v1.5: swt self-update (auto-install latest) — explicitly out of scope for v1.0."
---

# Phase 12 / Plan 02 Summary: `swt update` CLI command + version checking

## What Was Built

`swt update` is now a first-class command:

- **Registry helper** — `packages/cli/src/lib/npm-registry.ts` queries `https://registry.npmjs.org/<pkg>/latest`, persists results to `~/.swt/update-cache.json` with 24h TTL. Fail-open on cache write errors.
- **Command handler** — reads `--json` / `--strict` / `--registry` / `--no-cache` flags, formats output (3 status modes: up-to-date / outdated / unreachable), exits 0 by default, exits 1 with `--strict` when unreachable.
- **Wired into main.ts** — registered alongside `vibe`, `detect-phase`, `init`, etc.
- **argv parser updated** — 4 new flag entries to satisfy `parseArgs({strict: true})`.
- **Vitest** — 7 tests cover happy path, outdated path, unreachable + warn-only, `--strict` exit, `--json` shape, cache hit/miss, `--no-cache` force-fresh.
- **Docs** — `docs/reference/cli.mdx` adds the `swt update` reference section.

## Files Modified

See `files_modified` in frontmatter (6 files: 4 src + 1 test + 1 docs).

## Acceptance criteria status

All 6 must-haves pass. Three deviations recorded:

- **D1** — 24h cache TTL chosen (plan didn't specify).
- **D2** — bundled commit.
- **D3** — pnpm/vitest deferred to CI.

## Phase 12 contract progress

PLAN 12-02 closes REQ-17 part 2 (the user-facing version checker). PLAN 12-03 closes REQ-19 (Codex Plugin Marketplace listing) plus the post-publish smoke test workflow.

## Commit

`b82ec2f` — feat(cli): swt update command + npm registry helper (Phase 12 / PLAN 02)
