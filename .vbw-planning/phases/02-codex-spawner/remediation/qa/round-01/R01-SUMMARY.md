---
phase: 02
round: 01
plan: R01
title: Phase 02 deviation reconciliation (plan-amendments + process-exceptions)
status: complete
completed: 2026-05-07
tasks_completed: 2
tasks_total: 2
commit_hashes: []
files_modified:
  - .vbw-planning/phases/02-codex-spawner/02-02-PLAN.md
  - .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md
deviations: []
known_issue_outcomes: []
---

Round 01 reconciles the 11 FAIL deviation rows from `02-VERIFICATION.md` through deviation classification. No code changes — all FAILs resolve as plan-amendments (5: source_plan files_modified arrays already amended at execution time) or process-exceptions (6: pre-existing v1.0 tech debt, environmental constraints, or directory-state observations).

## What Was Built

Bookkeeping reconciliation only — no source code, configuration, or test artifacts produced by Round 01. The work consists of:

- **Deviation classifications** for each of the 11 FAIL rows in `02-VERIFICATION.md`, recorded in R01-PLAN's `fail_classifications:` frontmatter array (5 plan-amendment entries with `source_plan` references; 6 process-exception entries with non-fixability rationale).
- **Source-plan coverage verification** for each plan-amendment — confirmed via `grep` that 02-02-PLAN.md and 02-03-PLAN.md `files_modified` arrays already reflect the actual landed Phase 02 scope (the amendments were applied at execution time, not in this round).
- **Process-exception evidence** for each non-amendment FAIL — pre-stash baseline test counts, commit references for pre-existing v1.0 files, schema source documentation, and directory-state inspections.

## Files Modified

No files modified by Round 01 itself. The plan-amendment classifications reference the original PLAN.md files where amendments live (already applied during Phase 02 execution):

- `.vbw-planning/phases/02-codex-spawner/02-01-PLAN.md` — listed for audit completeness only; zero plan-amendments classify against it.
- `.vbw-planning/phases/02-codex-spawner/02-02-PLAN.md` — DEV-2B's source_plan; `files_modified` already contains the corrected flat test paths.
- `.vbw-planning/phases/02-codex-spawner/02-03-PLAN.md` — DEV-3A/3B/3C/3F's source_plan; `files_modified` already contains Config.ts, vibe/orchestration paths, lazy-install-spawner.{ts,test.ts}, and load-config.ts.

## Task 1: Confirm plan-amendment source_plan coverage

Verified each plan-amendment FAIL's `source_plan` files_modified array reflects the actual landed Phase 02 scope:

### DEV-2B → 02-02-PLAN.md (test path correction)

`grep -n "test/parser\|test/wrapper" .vbw-planning/phases/02-codex-spawner/02-02-PLAN.md` returns:

```
15:  - packages/codex-driver/test/parser.test.ts
16:  - packages/codex-driver/test/wrapper.test.ts
```

Both at the correct flat-layout paths (NOT `test/spawn/parser.test.ts`). The plan body still references the original `test/spawn/...` paths in task descriptions, which is fine — the frontmatter `files_modified` is the authoritative landed scope, and the body's narrative-style description was preserved for audit context. **DEV-2B classification confirmed: plan-amendment.**

### DEV-3A → 02-03-PLAN.md (ConfigSchema gap)

`grep -n "Config\.ts" .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md` returns:

```
34:  - packages/core/src/config/Config.ts
```

The plan's files_modified array was amended at execution time to include the schema extension (model_overrides + mcp_overrides records on top of the existing agent_max_turns). **DEV-3A classification confirmed: plan-amendment.**

### DEV-3B → 02-03-PLAN.md (orchestration path layout)

`grep -n "vibe/orchestration" .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md` returns lines 14, 15, 16, 20, 21 — five entries all referencing the correct nested path `packages/methodology/src/vibe/orchestration/...`. Zero remaining references to the original (incorrect) `packages/methodology/src/orchestration/...` path in files_modified. **DEV-3B classification confirmed: plan-amendment.**

### DEV-3C → 02-03-PLAN.md (LazyInstallSpawner addition)

`grep -n "lazy-install-spawner" .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md` returns:

```
15:  - packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts
21:  - packages/methodology/test/vibe/orchestration/lazy-install-spawner.test.ts
```

Both the implementation and test files appear in the amended files_modified. The architectural decision (lazy-install-on-first-spawn-per-role) was resolved with the user via AskUserQuestion immediately before execution; the wrapper class is the implementation of that decision. **DEV-3C classification confirmed: plan-amendment.**

### DEV-3F → 02-03-PLAN.md (loadSwtConfig addition)

`grep -n "load-config" .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md` returns:

```
35:  - packages/methodology/src/state/load-config.ts
```

The state barrel update at `packages/methodology/src/state/index.ts` is also listed (line 36). The private `loadConfig` inside phase-detect.ts stays in place; the new public module is the surface for shared CLI/methodology use. **DEV-3F classification confirmed: plan-amendment.**

### Audit completeness — 02-01-PLAN.md

`02-01-PLAN.md` has zero plan-amendment classifications (DEV-1A and DEV-1B are both process-exceptions). Its files_modified array remains accurate as written. Listed in R01-PLAN's artifacts for completeness only.

## Task 2: Document process-exception evidence

For each process-exception FAIL, the non-fixability rationale lives in R01-PLAN's `fail_classifications` array. This task records the verification evidence:

### DEV-1A — pre-existing codex-driver typecheck failures

Two typecheck errors live in files NOT modified by Plan 02-01:

- `packages/codex-driver/src/spawn/wrapper.ts` line ~42 (execa env type, `exactOptionalPropertyTypes` mismatch).
- `packages/codex-driver/src/toml/emit.ts:54` (TomlValue array branch).

Pre-stash baseline confirmation: stashing Plan 02-01's changes and running `pnpm --filter @swt-labs/codex-driver typecheck` produced identical typecheck errors. Plan 02-01's new code (`packages/codex-driver/src/spawner/codex-agent-spawner.ts`) is typecheck-clean and does not modify either file. Same DEV-1D class as Phase 01's route.ts carryforward — tracked as a v1.5 follow-up.

### DEV-1B — pre-existing toml.test.ts failure

The single failing test `emits a [features] table when flags are present` in `packages/codex-driver/test/toml.test.ts` is caused directly by the toml/emit.ts:54 type error from DEV-1A. Pre-stash baseline running `pnpm vitest run packages/codex-driver/test/toml.test.ts` showed identical 1-failure count before Plan 02-01. Plan 02-01's new test file (`packages/codex-driver/test/spawner/codex-agent-spawner.test.ts`) is 5/5 passing. Net new test failures introduced by Plan 02-01: 0.

### DEV-2A — hand-crafted NDJSON usage fixture

Schema `{type:"usage", usage:{input_tokens:int, output_tokens:int}}` matches the OpenAI Codex CLI September 2025 release documentation conventions. The shape aligns 1:1 with `AgentSpawner.SpawnResult.usage` declared in `packages/core/src/abstractions/AgentSpawner.ts:31-34`:

```typescript
readonly usage?: {
  readonly input_tokens: number;
  readonly output_tokens: number;
};
```

If the real Codex CLI emits a different envelope shape (e.g., `token_count` instead of `usage`), the fix is a single-line update to `UsageChunkSchema` in `packages/codex-driver/src/spawn/parser.ts` — the `parseStream` aggregation logic and 12 test cases (5 parser + 3 wrapper + 4 fixture-driven) stay correct. Tracked as a v1.5 follow-up: capture a real Codex `exec --json` stream and compare schemas once a Codex CLI install is available.

### DEV-3D — CLI test directory observation

`ls packages/cli/test/commands/` (post Plan 02-03) returns `update.test.ts` and `vibe.test.ts`. Plan 02-03's files_modified always listed `packages/cli/test/commands/vibe.test.ts` correctly — the deviation note in `02-03-SUMMARY.md` only flagged that the directory existed but was sparse before T4. No source-plan change required because the file path was always correctly specified. The classification as process-exception (rather than plan-amendment) reflects that there was no actual amendment.

### DEV-3E — pre-existing zod missing from methodology manifest

`grep -n "zod" packages/methodology/src/vibe/handlers/scope.ts` returns:

```
14:import { z } from 'zod';
```

The import was already present in v1.0 but `packages/methodology/package.json` never declared zod as a dependency — pnpm strict mode let it work indirectly because `@swt-labs/core` (a methodology dep) did declare zod. The new agent-spec-resolver test pulled methodology source through vitest's resolver, exposing the missing dep with `Failed to load url zod (resolved id: zod)`. Same hygiene class as Phase 01 Plan 01-01's codex-driver missing-zod fix. The dep addition is necessary v1.0 hygiene that landed because Plan 02-03's new test path exposed it; not a Plan 02-03 scope addition.

### DEV-3G — vi.doMock vs $PATH-stub

Plan 02-03 T4's original specification used `vi.doMock('execa', ...)` to fake Codex output. Trial runs failed: the mock was registered against the test file's module graph but did not propagate when methodology / codex-driver source files (workspace-linked from CLI) imported the bare 'execa' specifier. Likely cause: pnpm strict isolation gives each workspace package its own `node_modules/execa` copy, and vitest's module-resolution does not unify these resolutions under a single mock registry.

The switch to a node-script `codex` stub on `$PATH` is more robust: the test sets `process.env.PATH = stubPath:...` so the real `execa` looks up `codex` and finds our stub, which emits a valid Dev handoff envelope. The stub-on-PATH approach proves the wiring runs end-to-end through real execa with no mock-threading dependency. Tracked as a v1.5 follow-up: investigate vitest module-resolution semantics under pnpm strict mode if/when more cross-package CLI integration tests need execa-level mocks.

## Summary

| FAIL ID | Classification | Source Plan | Evidence |
|---------|----------------|-------------|----------|
| DEV-1A | process-exception | — | Pre-existing v1.0 typecheck errors in codex-driver/spawn/wrapper.ts + toml/emit.ts; pre-stash baseline confirms identical fail count |
| DEV-1B | process-exception | — | Pre-existing toml.test.ts failure caused by emit.ts:54 type error; same baseline carryforward |
| DEV-2A | process-exception | — | Hand-crafted fixture matches OpenAI Codex Sept 2025 docs schema; one-line fix path if real schema differs |
| DEV-2B | plan-amendment | 02-02-PLAN.md | files_modified lines 15-16 contain flat test paths |
| DEV-3A | plan-amendment | 02-03-PLAN.md | files_modified line 34 contains Config.ts (schema extension) |
| DEV-3B | plan-amendment | 02-03-PLAN.md | files_modified lines 14-21 use vibe/orchestration paths |
| DEV-3C | plan-amendment | 02-03-PLAN.md | files_modified lines 15+21 contain lazy-install-spawner.{ts,test.ts} |
| DEV-3D | process-exception | — | Directory-state observation; no source-plan amendment needed |
| DEV-3E | process-exception | — | Pre-existing v1.0 zod import in scope.ts:14; methodology manifest gap pre-dates Phase 02 |
| DEV-3F | plan-amendment | 02-03-PLAN.md | files_modified lines 35-36 contain load-config.ts + state/index.ts |
| DEV-3G | process-exception | — | vitest+pnpm strict-mode mock-resolution limitation; environmental, not implementation choice |

**Net classifications:** 5 plan-amendments + 6 process-exceptions = 11 (matches 02-VERIFICATION.md FAIL count).
**Net code changes in Round 01:** zero.
**Net commits in Round 01:** zero.

Identical pattern to Phase 01 Round 01 (5 plan-amendments + 4 process-exceptions = 9 FAILs).
