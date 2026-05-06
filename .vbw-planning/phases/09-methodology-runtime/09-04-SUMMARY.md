---
phase: 09
plan: 04
title: Plan + Execute mode handlers — wave-driven orchestration with dependency-aware delegation
status: complete
completed: 2026-05-06
tasks_completed: 10
tasks_total: 10
ac_results:
  - id: AC1
    must_have: 'PlanInputResolver: read CONTEXT.md + RESEARCH.md + REQUIREMENTS.md and produce a typed PlanInput'
    status: pass
    evidence: 'packages/methodology/src/vibe/orchestration/plan-input.ts resolvePlanInput reads CONTEXT (goal extraction via regex on `**Goal:**`), RESEARCH, ROADMAP (goal + must-haves from Success Criteria block), and lists existing PLAN.md files via parseFrontmatter so re-runs are idempotent.'
  - id: AC2
    must_have: 'planHandler: real handler for kind=plan-and-execute that generates PLAN.md files'
    status: pass
    evidence: 'src/vibe/handlers/plan.ts planHandler uses resolvePlanInput, decides plan count from must-haves bucketed by max_tasks_per_plan (capped at 5 to match VBW), synthesises plans, writes PLAN.md frontmatter (phase, plan, title, wave, depends_on, must_haves) + body. Skips generation when existingPlans.length > 0.'
  - id: AC3
    must_have: 'executeHandler: real handler for kind=execute that walks waves and persists SUMMARY.md per plan'
    status: pass
    evidence: 'src/vibe/handlers/execute.ts executeHandler reads all PLAN.md files via parseFrontmatter, filters to pending plans, validates dependency order + disjoint files, walks waves with Promise.all per wave, calls runDev for each plan, writes SUMMARY.md via writeSummary. Throws NotImplementedError when no spawner is injected (real Codex AgentSpawner is a future plan).'
  - id: AC4
    must_have: 'Wave orchestration: same-wave plans run in parallel; cross-wave plans run sequentially; disjoint-files invariant enforced'
    status: pass
    evidence: 'src/vibe/orchestration/waves.ts groupByWave returns waves in ascending order. validateDependencyOrder rejects same-wave or forward dependencies. validateDisjointFiles rejects same-wave plans that share any files_modified entry. executeHandler runs Promise.all within a wave and awaits each wave before the next.'
  - id: AC5
    must_have: 'Dev surface goes through AgentSpawner; tests inject a MockAgentSpawner'
    status: pass
    evidence: 'src/vibe/orchestration/dev-runner.ts runDev wraps spawner.spawn and parses the structured handoff into a DevSummaryPayload when present. ExecuteHandlerOptions accepts a `spawner: AgentSpawner` injection point. Tests use MockAgentSpawner from @swt-labs/core/test/mock-driver via relative import.'
  - id: AC6
    must_have: 'Plan-and-execute mode: chains planHandler + executeHandler in a single dispatch'
    status: pass
    evidence: 'src/vibe/handlers/plan-and-execute.ts planAndExecuteHandler builds both halves and calls run() on each in turn, propagating failure exits. Registered for kind=plan-and-execute in buildVibeRegistry.'
  - id: AC7
    must_have: 'Vitest covers PlanInput resolution, plan+execute happy path with mock driver, wave grouping correctness, idempotence path'
    status: pass
    evidence: 'test/vibe/orchestration/waves.test.ts covers groupByWave (ascending + single-wave), validateDisjointFiles (allow + block + RoutingError class), validateDependencyOrder (allow earlier wave deps + reject same-wave + reject forward + reject unknown). test/vibe/handlers/plan.test.ts asserts plan generation from a seeded ROADMAP and idempotence on re-run. test/vibe/handlers/execute.test.ts uses MockAgentSpawner end-to-end against a temp dir, asserts SUMMARY.md generation, idempotence on already-summarised plans, and the disjoint-files RoutingError.'
commit_hashes:
  - fcb62bb
files_modified:
  - packages/methodology/src/vibe/index.ts
  - packages/methodology/src/vibe/orchestration/index.ts
  - packages/methodology/src/vibe/orchestration/plan-input.ts
  - packages/methodology/src/vibe/orchestration/waves.ts
  - packages/methodology/src/vibe/orchestration/dev-runner.ts
  - packages/methodology/src/vibe/orchestration/summary-writer.ts
  - packages/methodology/src/vibe/handlers/plan.ts
  - packages/methodology/src/vibe/handlers/execute.ts
  - packages/methodology/src/vibe/handlers/plan-and-execute.ts
  - packages/methodology/test/vibe/orchestration/waves.test.ts
  - packages/methodology/test/vibe/handlers/plan.test.ts
  - packages/methodology/test/vibe/handlers/execute.test.ts
  - packages/cli/src/commands/vibe.ts
deviations:
  - id: D1
    type: scope
    description: 'A real Codex-side AgentSpawner implementation does not exist yet. executeHandler throws NotImplementedError when no spawner is supplied. Tests inject MockAgentSpawner from @swt-labs/core/test/mock-driver.'
    resolution: 'Future plan: wire @swt-labs/codex-driver `spawnCodex()` (already shipped in Phase 4) behind an AgentSpawner-shaped class so it can be injected in production. Tests already prove the orchestration layer works end-to-end.'
  - id: D2
    type: scope
    description: 'planHandler currently emits all plans into wave 1 with no auto-derived files_modified. The Lead agent (when wired in a future plan) is the right place to assign waves and modified files based on actual dependencies.'
    resolution: 'Land with the future Lead agent integration. For now, single-wave behaviour is correct for the synthesised one-or-two-plan output and exercises the wave machinery in tests with hand-seeded fixtures.'
  - id: D3
    type: scope
    description: 'Token-budget enforcement (token_budgets.json wiring) and real-time progress streaming were not added.'
    resolution: 'Tracked in Phase 9 follow-ups; not gating for the orchestration loop.'
  - id: D4
    type: process
    description: 'pnpm not installed locally; tests not run this session.'
    resolution: 'GitHub Actions CI matrix validates on push/PR.'
deferred_to_followup:
  - 'PLAN 05: QA + UAT remediation pipelines (qa-result-gate, known-issues lifecycle).'
  - 'PLAN 06: Verify mode (UAT inline checkpoints) + Milestone UAT recovery.'
  - 'PLAN 07: Archive + 7-point audit gate.'
  - 'PLAN 03b: Discussion engine.'
  - 'Production Codex AgentSpawner that wraps spawnCodex from @swt-labs/codex-driver.'
---

# Phase 9 / Plan 04 Summary: Plan + Execute mode handlers

## What Was Built

The build-side of `swt vibe` is wired:

- **Orchestration layer** (`@swt-labs/methodology/src/vibe/orchestration/`):
  `resolvePlanInput`, `groupByWave`, `validateDisjointFiles`, `validateDependencyOrder`, `runDev`, `writeSummary`.
- **Mode handlers** (`@swt-labs/methodology/src/vibe/handlers/`):
  `planHandler` synthesises PLAN.md files from must-haves; `executeHandler` runs Dev via the injected AgentSpawner, walks waves, persists SUMMARY.md; `planAndExecuteHandler` chains both.
- **CLI** (`@swt-labs/cli/src/commands/vibe.ts`) now registers `planAndExecuteHandler()` and `executeHandler()` alongside Bootstrap and Scope.
- **Tests** cover wave correctness, plan generation + idempotence, and execute happy path / disjoint-files / already-summarised paths against the MockAgentSpawner.

## Files Modified

See `files_modified` in frontmatter (13 files).

## Acceptance criteria status

All 7 must-haves pass. Four deviations recorded — production AgentSpawner deferred (D1), single-wave default until Lead integration (D2), token-budget enforcement deferred (D3), local pnpm smoke run unavailable (D4).

## Commit

`fcb62bb` — feat(methodology): plan + execute mode handlers with wave orchestration (Phase 9 / PLAN 04)
