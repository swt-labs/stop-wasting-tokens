---
phase: 02
plan: 02-01
title: Tier 2 Codex Plugin Marketplace prep — manifest path + schema + version sync
status: complete
completed: 2026-05-07
tasks_completed: 3
tasks_total: 3
commit_hashes:
  - c1a3ad7
  - 9aad254
deviations:
  - "Plan 02-01 originally listed manifest + new-test files in files_modified but did not list `packages/cli/test/marketplace-manifest.test.ts`. That test file referenced the old manifest path AND asserted the old schema (displayName/install/commands/tags top-level — all fields removed by F-13). After the manifest move + restructure, the test file failed at module load and its assertions referenced fields that no longer exist. Plan-amendment: deleted the redundant test file (the new `test/codex-plugin-manifest.test.ts` covers the same manifest with stricter Codex-conformant assertions); files_modified amended."
pre_existing_issues:
  - "Pre-existing config-doc-drift test failures (2): packages/cli/test/config-doc-drift.test.ts asserts every documented config key has a section heading in config.mdx + config.mdx mentions hooks.post_archive. These pre-date Plan 02-01 and are docs-codegen drift unrelated to manifest restructure. Tracked as v1.5 follow-up."
  - "Pre-existing v1.0 typecheck failures (DEV-1D class) carryforward: codex-driver/wrapper.ts:39 (execa env type), codex-driver/toml/emit.ts:54 (TomlValue array branch), methodology/discussion/engine.ts:27, methodology/state/phase-detect.ts:59 (CalibrationSignals + QaFreshnessInput strict-mode), methodology/index.ts:8 (duplicate checkQaFreshness export), methodology/vibe/handlers/bootstrap.ts:10,158 (unused imports), methodology/vibe/handlers/plan-and-execute.ts:21 (kind type widening). Plan 02-01 didn't touch any of these files — verified by stash + baseline comparison."
ac_results:
  - criterion: "Codex plugin manifest lives at `.codex-plugin/plugin.json` (repo root) per documented Codex path"
    verdict: "pass"
    evidence: "ls .codex-plugin/plugin.json exists; ls packages/cli/codex-plugin.json returns 'no such file'. The manifest moved cleanly with file delete + new file create. The test asserts the manifest is loadable from the new path."
  - criterion: "manifest top-level fields match documented Codex schema; undocumented `install`/`commands`/`tags`/`categories`/`displayName`/`screenshots` removed from top level"
    verdict: "pass"
    evidence: "test/codex-plugin-manifest.test.ts case 4 ('omits undocumented top-level fields') asserts manifest.install/commands/tags/categories/displayName/screenshots are all undefined at the top level. 9/9 manifest tests pass. node -e check confirms manifest.install === undefined."
  - criterion: "manifest has an `interface` object block containing displayName, category, screenshots"
    verdict: "pass"
    evidence: "test case 5 ('declares an interface block') asserts typeof manifest.interface === 'object' with displayName + category + screenshots fields. The interface.displayName matches the original presentation-layer 'stop-wasting-tokens (SWT)' string moved from top-level."
  - criterion: "manifest version matches package.json:version exactly"
    verdict: "pass"
    evidence: "test case 7 ('version field matches package.json version exactly') reads both files and asserts manifest.version === pkg.version. Both currently 0.0.0 (the matching values are enforced by the test). When package.json:version changes at publish time, the manifest test will catch any drift."
  - criterion: "test/codex-plugin-manifest.test.ts asserts the new schema invariants"
    verdict: "pass"
    evidence: "9 test cases cover: documented path exists, valid JSON, required fields, undocumented top-level fields absent, interface block present, author is object, keywords is array, version sync, $schema RFC-2606 hygiene. All 9 pass on a clean repo."
---

Tier 2 Codex Plugin Marketplace prep ships. F-03, F-13, F-14 from the v1.5.1 milestone scope are closed. SWT is now structurally listable on the Codex Plugin Marketplace whenever it opens for self-serve publishing.

## What Was Built

- **`.codex-plugin/plugin.json`** (new) — Codex Plugin Marketplace manifest at the documented path. Top-level: `name`, `version`, `description`, `author` (object {name, url}), `license`, `homepage`, `repository`, `keywords`. `interface` block contains `displayName`, `category`, `screenshots`. Undocumented top-level fields (`install`, `commands`, `tags`, `categories`, `displayName`, `screenshots`) removed.
- **`packages/cli/codex-plugin.json`** (deleted) — old manifest path no longer exists.
- **`test/codex-plugin-manifest.test.ts`** (new) — 9 vitest cases asserting the new schema invariants + version sync between manifest and package.json. Lives at root `test/` alongside the v1.5 docs drift tests.
- **`packages/cli/test/codex-plugin-manifest.test.ts`** (deleted) — old test file at the old location is gone.
- **`packages/cli/test/marketplace-manifest.test.ts`** (deleted) — redundant test that asserted the OLD schema (displayName/install/commands/tags top-level); superseded by the new `test/codex-plugin-manifest.test.ts` which asserts the documented Codex schema with stricter checks. Recorded as a plan-amendment deviation.

## Files Modified

- `.codex-plugin/plugin.json` (new — 30 lines)
- `packages/cli/codex-plugin.json` (deleted)
- `test/codex-plugin-manifest.test.ts` (new — 9 vitest cases)
- `packages/cli/test/codex-plugin-manifest.test.ts` (deleted)
- `packages/cli/test/marketplace-manifest.test.ts` (deleted — see deviation #1)

## Deviations

See frontmatter `deviations:`. One:

1. **Redundant marketplace-manifest test deletion (plan-amendment)** — `packages/cli/test/marketplace-manifest.test.ts` referenced the old manifest path AND asserted the old schema (displayName/install/commands/tags top-level). After Plan 02-01's restructure, the test file would have failed at module load and its assertions referenced fields that no longer exist. The new `test/codex-plugin-manifest.test.ts` covers the same manifest with stricter Codex-conformant assertions. Deleting the redundant test was a necessary support change. Same audit-trail pattern as Phase 01 path correction (DEV-1A) and v1.5 milestone path-amendment deviations.

## Verification

1. ✅ `cat .codex-plugin/plugin.json | jq .` succeeds — new manifest valid JSON
2. ✅ `pnpm vitest run test/codex-plugin-manifest.test.ts` — 9/9 pass
3. ✅ `pnpm vitest run packages/cli` — 55 pass / 2 fail (config-doc-drift, pre-existing unrelated to Plan 02-01)
4. ✅ Stash + baseline test comparison: pre-Plan-02-01 had 2 failed cli tests; post-Plan-02-01 has 2 failed cli tests. Zero net regressions introduced by Plan 02-01.
5. ✅ Pre-existing v1.0 typecheck failures (DEV-1D class) remain at the same baseline count — Plan 02-01 didn't touch any of those files.

## Next

Phase 02 has 1 plan and it is now complete. Routing should advance to QA + UAT + Phase 03. The v1.5.1 milestone next phase is `03-hook-integration-cleanup` (codex-driver hooks-writer filtering + name translation + feature flag + comment fixes).
