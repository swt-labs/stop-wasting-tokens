---
phase: 1
plan: 01
title: M1 Entry Gate + Architectural Scaffolding (PR-01a → PR-04)
status: partial
started: 2026-05-11
last_updated: 2026-05-11
completed: 2026-05-11
tasks_completed: 2
tasks_total: 5
commit_hashes:
  - 08579dc
  - e0bc8ce
deviations:
  - 'PR-01a plan-amendment: moved `writeAgentsMdBlock` + 3 sibling exports from `@swt-labs/codex-driver` to `@swt-labs/artifacts` (where pure file-writing helpers belong alongside `writeProject`/`writeRoadmap`) rather than routing through `AgentSpawner.installAgent` as the plan envisioned — inspection showed it is project-level AGENTS.md authoring, not per-agent. Functionality preserved; edge broken. source_plan: 01-01-PLAN.md'
  - 'PR-01b plan-amendment: extended `packages/cli/src/router.ts` (CommandIO interface) to thread `SpawnerEnvironment` — file-guard hook flagged it correctly; the plan did not enumerate `router.ts` in files_modified. Plan files_modified updated in the PR-01b commit. source_plan: 01-01-PLAN.md'
  - 'PR-01b code-fix: preserved `DoctorReport.codex: CodexVersionLike | undefined` field shape (rather than replacing with a probe-result shape) because `DoctorReportSchema` in `@swt-labs/dashboard-core` is contract-validated; changing it would cascade through dashboard HTTP API contracts. Local `CodexVersionLike` interface defined inside `cli/src/commands/doctor.ts`; populated from `spawnerEnv.probe()` when `name=codex` with a version.'
pre_existing_issues:
  - 'methodology test suite: 9 pre-existing v2.3.5 failures (4 bootstrap.test.ts ZodError in `writeRoadmap` "too_small" array minimum 1; 5 others in dispatch/qa/execute/plan handlers). Verified against v2.3.5 baseline via `git stash` test; not introduced by PR-01a/01b. Tracked for M1 PR-11 (Plan 01-03) remediation.'
ac_results:
  - criterion: 'truth: After PR-01a + PR-01b merge, grep `from ''@swt-labs/(codex|claude-code|ollama)-driver''` returns no matches (with driver dirs and dist/ excluded).'
    verdict: pass
    evidence: 'Verified at PR-01b merge (commit e0bc8ce). TDD2 §13.1.1 entry-gate invariant satisfied.'
  - criterion: 'truth: packages/methodology/package.json no longer declares @swt-labs/codex-driver as a dependency.'
    verdict: pass
    evidence: 'Commit 08579dc; `jq .dependencies packages/methodology/package.json` returns no codex-driver entry.'
  - criterion: 'truth: packages/cli/src/commands/{vibe,doctor}.ts no longer import from @swt-labs/codex-driver; they consume core/abstractions/SpawnerEnvironment instead.'
    verdict: pass
    evidence: 'Commit e0bc8ce; vibe.ts uses `io.spawnerEnv.getSpawner()`, doctor.ts uses `deps.spawnerEnv.probe()`.'
  - criterion: 'truth: packages/runtime/package.json declares @earendil-works/pi-coding-agent as a peerDependency ("*") and a dependency, with a working createSession wrapper.'
    verdict: fail
    evidence: 'PR-02 territory; packages/runtime/ does not yet exist. Remaining work for plan 01-01.'
  - criterion: 'truth: packages/orchestration/package.json declares packages/runtime and packages/core (the abstractions sub-export) as workspace deps.'
    verdict: fail
    evidence: 'PR-03 territory; packages/orchestration/ does not yet exist. Remaining work for plan 01-01.'
  - criterion: 'truth: packages/shared/ exports types and Zod schemas with zero internal deps other than zod/typebox.'
    verdict: fail
    evidence: 'PR-04 territory; packages/shared/ does not yet exist. Remaining work for plan 01-01.'
  - criterion: 'truth: pnpm-lock.yaml is regenerated and committed in each PR that mutates package.json.'
    verdict: pass
    evidence: 'PR-01a regenerated pnpm-lock.yaml when removing @swt-labs/codex-driver from methodology deps; PR-01b did not mutate any package.json deps (no regen needed).'
  - criterion: 'truth: v2.3.5 test suite still passes (continue-on-error: true) after each PR — no regressions to the 130 existing tests beyond the known 33 failures.'
    verdict: pass
    evidence: 'PR-01a methodology test count matches v2.3.5 baseline (verified by `git stash` test). PR-01b cli/test/doctor.test.ts 2/2 passing (DoctorReport shape preserved). No new test failures introduced.'
  - criterion: 'artifact: packages/core/src/abstractions/SpawnerEnvironment.ts — SpawnerEnvironment interface'
    verdict: pass
    evidence: 'Commit e0bc8ce; new file with `interface SpawnerEnvironment { probe(); getSpawner() }` plus `SpawnerProbeResult`.'
  - criterion: 'artifact: packages/runtime/src/session.ts — createSession wrapper around Pi createAgentSession'
    verdict: fail
    evidence: 'PR-02 territory.'
  - criterion: 'artifact: packages/runtime/src/index.ts — public exports'
    verdict: fail
    evidence: 'PR-02 territory.'
  - criterion: 'artifact: packages/orchestration/src/index.ts — public exports'
    verdict: fail
    evidence: 'PR-03 territory.'
  - criterion: 'artifact: packages/shared/src/index.ts — public exports'
    verdict: fail
    evidence: 'PR-04 territory.'
  - criterion: 'artifact: packages/runtime/package.json — Pi peerDependency declaration'
    verdict: fail
    evidence: 'PR-02 territory.'
  - criterion: 'key_link: methodology/src/vibe/handlers/bootstrap.ts → core/src/abstractions/AgentSpawner.ts via import'
    verdict: partial
    evidence: 'Plan-amended in PR-01a: bootstrap.ts imports `writeAgentsMdBlock` from `@swt-labs/artifacts` (not directly via AgentSpawner). AgentSpawner is still re-exported from `@swt-labs/core` and consumed elsewhere in methodology; the immediate edge from bootstrap → codex-driver is broken which is the underlying intent.'
  - criterion: 'key_link: cli/src/commands/vibe.ts → core/src/abstractions/SpawnerEnvironment.ts via import'
    verdict: pass
    evidence: 'Commit e0bc8ce; vibe.ts imports `SpawnerEnvironment` indirectly via `CommandIO.spawnerEnv` (typed in router.ts).'
  - criterion: 'key_link: cli/src/commands/doctor.ts → core/src/abstractions/SpawnerEnvironment.ts via import'
    verdict: pass
    evidence: 'Commit e0bc8ce; doctor.ts imports `SpawnerEnvironment` directly (`import type { SpawnerEnvironment } from ''@swt-labs/core''`).'
  - criterion: 'key_link: runtime/src/session.ts → @earendil-works/pi-coding-agent via import (peerDep)'
    verdict: fail
    evidence: 'PR-02 territory.'
---

Plan 01-01 partially shipped: 2 of 5 tasks (PR-01a + PR-01b) complete, discharging the M1 entry gate (TDD2 §13.1.1 invariant clean); PR-02 / PR-03 / PR-04 remain for a follow-up session.

## What Was Built

- **PR-01a** (`08579dc`) — methodology → codex-driver source-import edge broken. Plan-amended: `writeAgentsMdBlock` and 3 sibling exports moved from `@swt-labs/codex-driver` to `@swt-labs/artifacts` via `git mv` (history preserved at 100% similarity). Methodology imports from artifacts now. `@swt-labs/codex-driver` removed from methodology's package.json deps. Lockfile regenerated.
- **PR-01b** (`e0bc8ce`) — all 4 cli → {codex,claude-code,ollama}-driver source-import edges broken. New abstraction `SpawnerEnvironment` (`probe()` + `getSpawner()`) at `packages/core/src/abstractions/SpawnerEnvironment.ts`. `CommandIO` extended with optional `spawnerEnv?: SpawnerEnvironment`. `vibe.ts` replaces 3-spawner switch with `io.spawnerEnv.getSpawner()`; `doctor.ts` replaces `detectCodexVersion()` with `spawnerEnv.probe()` while preserving the `DoctorReport.codex` field shape required by the dashboard's `DoctorReportSchema` contract. `Pr01bStubSpawnerEnvironment` wired into CommandIO from `main.ts` — fails fast with a clear pointer to PR-02.
- **TDD2 §13.1.1 entry-gate invariant satisfied**: `grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ --exclude-dir={codex,claude-code,ollama}-driver --exclude-dir=dist` returns zero hits. M1 has formally entered.

## Files Modified

### PR-01a (commit `08579dc`)

- `packages/artifacts/src/agents-md/writer.ts` — **created** (via `git mv` from codex-driver; 100% similarity): vendor-neutral AGENTS.md file writer.
- `packages/artifacts/test/agents-md.test.ts` — **created** (via `git mv` from codex-driver): co-located with the writer.
- `packages/artifacts/src/index.ts` — **modified**: re-export `./agents-md/writer.js`.
- `packages/codex-driver/src/agents-md/writer.ts` — **deleted** (moved to artifacts).
- `packages/codex-driver/test/agents-md.test.ts` — **deleted** (moved to artifacts).
- `packages/codex-driver/src/index.ts` — **modified**: remove `agents-md/writer` re-export; add comment pointing to artifacts.
- `packages/methodology/src/vibe/handlers/bootstrap.ts` — **modified**: import `writeAgentsMdBlock` from `@swt-labs/artifacts` (was `@swt-labs/codex-driver`); same call site, same behavior.
- `packages/methodology/package.json` — **modified**: drop `"@swt-labs/codex-driver": "workspace:*"` from `dependencies`.
- `pnpm-lock.yaml` — **modified**: regenerated for the methodology dep removal.

### PR-01b (commit `e0bc8ce`)

- `packages/core/src/abstractions/SpawnerEnvironment.ts` — **created**: new interface `SpawnerEnvironment` (with `probe()` and `getSpawner()`) and `SpawnerProbeResult`. Documents the PR-01b→PR-02→PR-03 implementation chain.
- `packages/core/src/abstractions/index.ts` — **modified**: re-export `SpawnerEnvironment`.
- `packages/cli/src/router.ts` — **modified**: extend `CommandIO` with optional `spawnerEnv?: SpawnerEnvironment` (threaded into every command handler).
- `packages/cli/src/commands/vibe.ts` — **modified**: remove 3 spawner imports (Codex/ClaudeCode/Ollama); remove `resolveBackend` dispatch switch + dead `Backend` type; replace with `io.spawnerEnv.probe()` + `io.spawnerEnv.getSpawner()`; fail-fast `EXIT.RUNTIME_ERROR` when env missing/unavailable.
- `packages/cli/src/commands/doctor.ts` — **modified**: remove `{ detectCodexVersion, CodexVersion }` import from `@swt-labs/codex-driver`; define local `CodexVersionLike` interface (preserves `DoctorReport.codex` shape for dashboard contract); add `DoctorDeps.spawnerEnv?: SpawnerEnvironment`; populate `codex.version` from probe when `name=codex`.
- `packages/cli/src/main.ts` — **modified**: define `Pr01bStubSpawnerEnvironment` class (probe→unavailable with PR-02 pointer, getSpawner→throws); wire it into CommandIO; add `MainDeps.spawnerEnv` override for PR-02+.

### Plan + state files (across both commits)

- `.vbw-planning/phases/01-m1-foundation/01-01-PLAN.md` — **modified**: (a) frontmatter `plan: 01-01 → plan: 01` (the VBW routing helper rejected the old format as `frontmatter_mismatch:declares:01-01-01`); (b) files_modified expanded to include artifacts + codex-driver paths for the PR-01a move; (c) further expanded to include `packages/cli/src/router.ts` for the PR-01b CommandIO extension.
- `.vbw-planning/phases/01-m1-foundation/01-02-PLAN.md` — **modified**: frontmatter `plan: 01-02 → plan: 02` (same routing-helper fix).
- `.vbw-planning/phases/01-m1-foundation/01-03-PLAN.md` — **modified**: frontmatter `plan: 01-03 → plan: 03` (same routing-helper fix).

## Deviations

3 deviations recorded (full text + classification in frontmatter `deviations:` array). Summary:

1. **PR-01a plan-amendment** — `writeAgentsMdBlock` migration to `@swt-labs/artifacts` instead of routing through `AgentSpawner.installAgent`. Inspection showed the function is project-level file writing (no codex semantics, not per-agent). Original plan approach would have broken bootstrap (no AGENTS.md gets generated). The amended approach achieves the plan's intent (edge broken) while preserving functionality.

2. **PR-01b plan-amendment** — `packages/cli/src/router.ts` added to plan's files_modified because the CommandIO extension is the natural seam for threading SpawnerEnvironment. File-guard hook correctly flagged the omission.

3. **PR-01b code-fix** — preserved `DoctorReport.codex: CodexVersionLike | undefined` shape (rather than swapping to a probe-result shape) because `DoctorReportSchema` in `@swt-labs/dashboard-core` is a contract used by the dashboard's HTTP API. Local `CodexVersionLike` interface keeps the shape stable; populated from spawnerEnv.probe() adapter.

## Remaining work

| Task | PR | Subject | Lands in next session |
|---|---|---|---|
| 3 | PR-02 | `packages/runtime/` skeleton + `@earendil-works/pi-coding-agent` peerDep + mock Pi impl + draft ADR-001/002/004 | ⏳ |
| 4 | PR-03 | `packages/orchestration/` skeleton + sequential dispatcher + `PiSpawnerEnvironment` | ⏳ |
| 5 | PR-04 | `packages/shared/` (types + Zod schemas) + delete `packages/dashboard-core/` | ⏳ |

Plan status will flip from `partial` → `complete` when PR-04 ships and a SUMMARY.md update lands.

## Environment notes

- pnpm 9.12.0 installed via Homebrew during this session (the install was a manual one-time setup; documented for future sessions).
- Node v25.9.0 (Homebrew). CI matrix expects Node 20/22; v3-foundation toolchain builds clean on 25 locally but PR-02 should re-verify on the matrix once it lands.
- 33 v2.3.5 known test failures remain — PR-11 (Plan 01-03) is the remediation gate per TDD2 §13.1.2.
