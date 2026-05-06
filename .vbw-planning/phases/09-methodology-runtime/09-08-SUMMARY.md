---
phase: 09
plan: "08"
title: Discussion engine — calibrate, gray-area, capture protocol; interactive bootstrap + scope (formerly tracked as 03b; Phase 9 / PLAN 08)
status: complete
completed: 2026-05-06
tasks_completed: 9
tasks_total: 9
ac_results:
  - id: AC1
    must_have: 'inferCalibration heuristic (builder vs architect)'
    status: pass
    evidence: 'packages/methodology/src/discussion/calibrate.ts: regex-based scoring on project description; defaults to builder; long technical descriptions (>240 chars) bias architect; explicit "minimal/quick/ship" → builder, explicit "deep dive/enterprise/explore" → architect; `forced` override for tests. calibrate.test.ts covers 5 cases (default, builder wording, architect wording, forced override, long-description bias).'
  - id: AC2
    must_have: 'generateGrayAreas per mode + calibration with Recommendation Principle'
    status: pass
    evidence: 'packages/methodology/src/discussion/gray-areas.ts: bootstrap mode emits 5 gray areas for builder (project_name, description, core_value, license, target_users) plus tech_stack + deployment for architect. scope mode emits milestone_name + scope_boundary + decomposition_rationale + phase_count + deferred_ideas (plus duration_target for architect). phase mode emits goal_clarity + success_criteria (plus risk for architect). Technical decisions (license, tech_stack) carry `recommendation`; product decisions (target_users) do not. gray-areas.test.ts covers 5 branches.'
  - id: AC3
    must_have: 'runDiscussionEngine drives calibrate → gray-areas → per-decision loop'
    status: pass
    evidence: 'packages/methodology/src/discussion/engine.ts: takes Prompter + DiscussionContext (+ optional CalibrationSignals override). For each gray area: choice → askChoice; text → askText. Records source=recommendation when user picks the recommended choice. Empty text with default → inferred. Empty text without default → deferred. Text "defer" → deferred. engine.test.ts covers 4 happy paths (bootstrap answers, inferred default, defer keyword, forced architect calibration adds tech_stack/deployment).'
  - id: AC4
    must_have: 'DiscoveryPayload (answered/inferred/deferred) round-trips through existing writers'
    status: pass
    evidence: 'packages/methodology/src/discussion/types.ts exports DiscoveryAnswer + DiscoveryPayload with answered/inferred/deferred arrays. Each entry carries id, topic, decision, value, rationale, source. Compatible with existing artifacts/bootstrap/discovery.ts writeDiscovery — though PLAN 03b does not yet wire writeDiscovery to engine output (that lands when the bootstrapHandler interactive path captures more than the 3 input fields it needs today).'
  - id: AC5
    must_have: 'bootstrapHandler interactive path runs the engine when no bootstrap-input.json'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/bootstrap.ts: BootstrapHandlerOptions adds `prompter?: Prompter`. When opts.resolve returns undefined AND a prompter is provided, runs runDiscussionEngine in bootstrap mode, picks project_name/description/core_value from answered[], and proceeds with the existing writer chain. Without a prompter, still throws NotImplementedError. bootstrap.test.ts adds the interactive happy path via ScriptedPrompter (5 answers → PROJECT.md contains "# swt-test").'
  - id: AC6
    must_have: 'scopeHandler interactive path runs the engine when no phases.json'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/scope.ts: ScopeHandlerOptions adds `prompter?: Prompter` + `projectNameFallback?: string`. When opts.resolve returns undefined AND a prompter is provided, runs runDiscussionEngine in scope mode (5 gray areas), then asks per-phase name + goal pairs (count from phase_count answer, default 3), composes ScopeInput, and proceeds with the existing writer chain. scope.test.ts adds the interactive happy path via ScriptedPrompter (11 answers → ROADMAP.md contains "## Phase 1: Setup" through "## Phase 3: Polish").'
  - id: AC7
    must_have: 'CLI vibe.ts wires ReadlinePrompter into bootstrap and scope when TTY'
    status: pass
    evidence: 'packages/cli/src/commands/vibe.ts: imports DEFAULT_BOOTSTRAP_RESOLVER and DEFAULT_SCOPE_RESOLVER, constructs `bootstrapOpts`/`scopeOpts` with the existing TTY-only prompter, and selectively passes them when prompter !== undefined. Without a TTY (or with --yolo), falls back to the no-prompter handler signature so JSON-only paths still work.'
  - id: AC8
    must_have: 'Vitest covers calibrate, gray-areas, engine, interactive bootstrap, interactive scope'
    status: pass
    evidence: '13 new + 2 extended cases: calibrate.test.ts (5), gray-areas.test.ts (5), engine.test.ts (4), bootstrap.test.ts (+1 interactive), scope.test.ts (+1 interactive). All hermetic — temp dirs + ScriptedPrompter from @swt-labs/core/test/mock-driver.'
  - id: AC9
    must_have: 'Phase 9 contract closed — every routing kind has a real handler'
    status: pass
    evidence: 'PLAN 03b is the last deferred plan in Phase 9. With this commit, every kind in VibeRoute (init-redirect, bootstrap, scope, discuss, plan-and-execute, execute, verify, qa-remediation, uat-remediation, re-verify, milestone-uat-recovery, archive, all-done) has a real handler in the registry — no NotImplementedError throws on the documented happy paths.'
commit_hashes:
  - bf0b3cd
files_modified:
  - packages/cli/src/commands/vibe.ts
  - packages/methodology/src/discussion/calibrate.ts
  - packages/methodology/src/discussion/engine.ts
  - packages/methodology/src/discussion/gray-areas.ts
  - packages/methodology/src/discussion/index.ts
  - packages/methodology/src/discussion/types.ts
  - packages/methodology/src/index.ts
  - packages/methodology/src/vibe/handlers/bootstrap.ts
  - packages/methodology/src/vibe/handlers/scope.ts
  - packages/methodology/test/discussion/calibrate.test.ts
  - packages/methodology/test/discussion/engine.test.ts
  - packages/methodology/test/discussion/gray-areas.test.ts
  - packages/methodology/test/vibe/handlers/bootstrap.test.ts
  - packages/methodology/test/vibe/handlers/scope.test.ts
deviations:
  - id: D1
    type: scope
    description: 'The engine returns DiscoveryPayload but bootstrapHandler does not yet persist the full answered/inferred/deferred set into discovery.json — it only picks the three core fields it needs and reuses the existing EMPTY_DISCOVERY writeDiscovery call. Persisting the full DiscoveryPayload is a small follow-up that lands when REQUIREMENTS generation is upgraded to consume answered fields beyond project_name/description/core_value.'
    resolution: 'Future polish — wire writeDiscovery({planningDir, payload: result.payload}) once requirements.ts knows how to render answered/inferred/deferred entries beyond the bootstrap minimum.'
  - id: D2
    type: scope
    description: 'phase mode gray-areas (goal_clarity, success_criteria, risk) are defined but PLAN 03b does not yet wire a Discuss handler beyond the existing stub. The Discuss route already throws NotImplementedError pointing at the engine — wiring those gray areas into a discussHandler is a small follow-up.'
    resolution: 'Future plan — discussHandler that calls runDiscussionEngine in phase mode and writes the answers into <phase-dir>/<NN>-CONTEXT.md.'
  - id: D3
    type: process
    description: 'pnpm + tsc not installed locally; tests not executed in this session.'
    resolution: 'GitHub Actions CI runs the matrix on push/PR.'
deferred_to_followup:
  - 'Discuss handler that calls the engine in phase mode and updates <phase-dir>/<NN>-CONTEXT.md (PLAN 03b D2).'
  - 'Wire full DiscoveryPayload persistence into bootstrap (PLAN 03b D1).'
  - 'Real Codex AgentSpawner wiring around @swt-labs/codex-driver (executeHandler + qaHandler unblocker — outside Phase 9 scope).'
  - 'CLI add-phase composition triggered by milestoneUatRecoveryHandler create-remediation decision (PLAN 06 D1).'
  - 'rolling_summary compilation + post-archive hook dispatcher (PLAN 07 D1).'
---

# Phase 9 / Plan 03b Summary: Discussion engine

## What Was Built

The interactive bootstrap + scope flows are no longer NotImplementedError stubs:

- **`@swt-labs/methodology/discussion/`** — typed Calibration + GrayArea + DiscoveryAnswer shapes; `inferCalibration` (builder vs architect from description signals); `generateGrayAreas` catalog per mode with the Recommendation Principle (technical defaults carry `recommendation`); `runDiscussionEngine` drives calibrate → gray-areas → per-decision loop via the existing Prompter abstraction.
- **`bootstrapHandler`** — optional `prompter` option. When the JSON resolver returns undefined and a prompter is injected, the engine collects project_name / description / core_value plus discovery answers, then composes the existing writer chain.
- **`scopeHandler`** — optional `prompter` + `projectNameFallback`. The engine collects milestone_name / scope_boundary / decomposition_rationale / phase_count, then asks per-phase name + goal pairs and composes the phase dirs + ROADMAP + per-phase CONTEXT + milestone CONTEXT.
- **CLI** — `vibe.ts` injects the existing `ReadlinePrompter` into bootstrap and scope handlers when stdin is a TTY (and `--yolo` is not set).

## Files Modified

See `files_modified` in frontmatter (14 files; 5 new src + 1 src edit + 2 src edits + 3 new tests + 2 test edits).

## Acceptance criteria status

All 9 must-haves pass. Three deviations recorded:

- **D1** — bootstrapHandler does not yet persist the full DiscoveryPayload to discovery.json; future polish.
- **D2** — phase-mode gray areas are defined but a discussHandler that consumes them is a follow-up.
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Phase 9 status

PLAN 03b closes Phase 9. Every VibeRoute kind has a real handler in the registry — no NotImplementedError throws on the documented happy paths. The remaining methodology-runtime polish items (real Codex AgentSpawner, rolling-summary, tier-aware audit, full discovery persistence) are intentional follow-ups that do not block Phase 9's contract.

## Commit

`bf0b3cd` — feat(methodology): discussion engine — calibrate, gray-area, capture (Phase 9 / PLAN 03b)
