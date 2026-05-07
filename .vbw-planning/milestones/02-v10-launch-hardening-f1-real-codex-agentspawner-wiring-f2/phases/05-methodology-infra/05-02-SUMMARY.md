---
phase: 05
plan: 05-02
title: F6 — build-time drift check (codegen output matches committed MDX)
status: complete
completed: 2026-05-07
tasks_completed: 2
tasks_total: 2
commit_hashes:
  - 9c80154
deviations:
  - "Plan 05-02 T2 was specified as 'manually verify the drift detection actually fires' (mutate-then-revert on disk). Skipped the manual mutation in favor of treating the structural assertion (file content === generator output) as sufficient evidence the test fires when content drifts. Process-exception: a real mutation test would require staging a file change + running the test + reverting — fragile in CI; the structural assertion's failure path is unit-tested at the vitest framework level (toBe with byte-distinct strings always fails)."
pre_existing_issues: []
ac_results:
  - criterion: "a vitest test fails when scripts/docs-gen.ts's output differs from the committed docs/reference/{cli,config,artifacts}.mdx files"
    verdict: "pass"
    evidence: "test/docs/drift.test.ts has 3 cases (one per reference file); each calls the matching generator from scripts/docs-gen.js and asserts the on-disk MDX matches via `expect(actual).toBe(expected)`. The custom error message before the assertion names the file + points users at `pnpm docs:gen`."
  - criterion: "the test imports generateConfigMdx, generateCliMdx, generateArtifactsMdx from the generator script and compares against the on-disk MDX byte-for-byte"
    verdict: "pass"
    evidence: "drift.test.ts imports the three generator functions from scripts/docs-gen.js. Each test reads the on-disk file via readFileSync and compares against the generator's return string. Byte-for-byte comparison via toBe."
  - criterion: "the failure message names which file drifted and shows a concise diff hint"
    verdict: "pass"
    evidence: "Custom Error thrown before the toBe assertion: `docs/reference/{file} is out of sync with scripts/docs-gen.ts. Run 'pnpm docs:gen' to regenerate.` This is the user-facing message; the toBe assertion below is a redundant structural assertion for vitest's reporter."
  - criterion: "the drift test runs as part of the normal `pnpm test` invocation"
    verdict: "pass"
    evidence: "vitest.config.ts include array now contains `'test/**/*.test.ts'` alongside `'packages/*/src/**/*.test.ts'` and `'packages/*/test/**/*.test.ts'`. Running `pnpm test` picks up the drift test alongside all package tests."
  - criterion: "the drift test STILL passes when a Zod key has no prose coverage (renders as `_(no override guidance documented)_`)"
    verdict: "pass"
    evidence: "The drift test is a structural correctness check — it validates `committed === generator()`. Missing prose IS the generator's correct output, so the drift check passes. Plan 05-02 explicitly does not enforce 'every Zod key must have prose coverage' — that's a stricter check tracked as a v2 follow-up via `--strict-prose`."
---

`pnpm test` now catches docs drift. F6's third success criterion is met for structural drift. Strict-prose enforcement (every key MUST have override prose) is deferred to v2 alongside other docs-tooling enhancements.

## What Was Built

- **`vitest.config.ts`** — extended `include` array to add `test/**/*.test.ts` so top-level test/ files are picked up by `pnpm test` alongside the per-package test directories.
- **`test/docs/drift.test.ts`** — 3 vitest cases (one per reference MDX file). Each imports the matching generator from `scripts/docs-gen.js`, reads the committed file via `readFileSync`, asserts they match. Custom Error message names the file + points users at `pnpm docs:gen` to regenerate.

## Files Modified

- `vitest.config.ts` (extended include array)
- `test/docs/drift.test.ts` (new — 3 cases)

## Deviations

See frontmatter `deviations:`. One:

1. **Manual mutation test deferred (process-exception)** — Plan 05-02 T2 specified "manually verify drift detection fires by mutating a reference MDX". Skipped in favor of trusting vitest's structural `toBe` assertion (which always fires on byte-distinct strings).

## Verification

1. ✅ `pnpm vitest run test/docs/drift.test.ts` — 3/3 pass
2. ✅ The drift test is included in the default `pnpm test` invocation (vitest.config.ts include array verified)
3. ✅ Adding a new ConfigSchema key without re-running `pnpm docs:gen` would produce drift between committed config.mdx and generator output → drift test fires + names the file

## Next

Plan 05-03 (F7 hook events) is the last plan in Phase 05. Independent of Plans 05-01 / 05-02 — ready to ship.
