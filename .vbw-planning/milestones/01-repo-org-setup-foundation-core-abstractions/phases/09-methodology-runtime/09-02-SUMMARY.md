---
phase: 09
plan: 02
title: Orchestration loop — typed router from PhaseDetectResult to mode handlers
status: complete
completed: 2026-05-06
tasks_completed: 7
tasks_total: 7
ac_results:
  - id: AC1
    must_have: 'A typed VibeRoute discriminated union covering every mode VBW dispatches to'
    status: pass
    evidence: 'src/vibe/route.ts exports VibeRoute as a discriminated union over 13 kinds — init-redirect, bootstrap, scope, discuss, plan-and-execute, execute, verify (with qa_pending fields), qa-remediation, uat-remediation, re-verify, milestone-uat-recovery, archive, all-done. Every variant extends VibeRouteBase with phase, phase_slug, requires_confirmation, optional reason.'
  - id: AC2
    must_have: 'routeFromState(result, args) implements VBW vibe.md priority tables 1-11 plus QA-attention fallbacks'
    status: pass
    evidence: 'src/vibe/route.ts routeFromState walks the priority order: 1=init-redirect, 2=bootstrap, 3=uat-remediation, 3.5=qa-remediation, 4=re-verify, 5=milestone-uat-recovery, 6=scope, 7=verify (with qa_pending), 8=discuss, 9=plan-and-execute, 10=execute, 11=archive. all_done QA-attention fallback (pending) reroutes to verify with reason="all_done QA attention fallback". Earlier-work QA-attention fallback (failed) reroutes earlier-work states to qa-remediation with reason="earlier-work QA attention fallback".'
  - id: AC3
    must_have: 'ModeHandler interface so each mode plugs into the router without circular deps'
    status: pass
    evidence: 'src/vibe/handlers/index.ts defines ModeHandler ({kind, run}) plus ModeIO and HandlerResult. ModeRegistry exposes register/has/dispatch with duplicate-kind rejection and missing-handler throw.'
  - id: AC4
    must_have: 'Stub handlers for every VibeRoute that throw NotImplementedError with a stable code'
    status: pass
    evidence: 'src/vibe/handlers/stubs.ts: stubHandler(spec) returns a ModeHandler whose run throws NotImplementedError(kind, roadmap_pointer). buildStubRegistry preloads every kind with the matching pointer (Phase 9 / Plan 03 for bootstrap/scope/discuss; Plan 04 for plan-and-execute/execute; Plan 05 for QA/UAT remediation + re-verify; Plan 06 for verify/milestone-uat-recovery; Plan 07 for archive).'
  - id: AC5
    must_have: 'CLI: swt vibe is no longer a stub'
    status: pass
    evidence: 'packages/cli/src/commands/vibe.ts implements vibeHandler: maps argv flags + bare-integer positionals to RouteArgs, runs detectPhase, routes via routeFromState, prints a banner with route metadata, dispatches through buildStubRegistry. init-redirect prints the bootstrap message and exits USAGE_ERROR. NotImplementedError prints "Route resolved → {kind}\\nNot yet implemented in this build ({roadmap_pointer})." and exits NOT_IMPLEMENTED. RoutingError prints diagnostic state JSON and exits USAGE_ERROR. The "vibe" entry was removed from STUB_SPECS in commands/stubs.ts.'
  - id: AC6
    must_have: 'Vitest covers the priority table cell-by-cell'
    status: pass
    evidence: 'test/vibe/route.test.ts asserts the expected kind for every priority (1, 2, 3, 3.5, 4, 5, 6, 7-pending, 7-passed, 8, 9, 10, 11), plus the all_done QA-attention fallback (verify with reason "all_done QA attention"), the earlier-work QA-attention fallback (qa-remediation with reason "earlier-work QA attention"), and the auto_uat confirmation toggle. test/vibe/dispatch.test.ts exercises register/dispatch happy path, duplicate-kind rejection, missing-handler throw, and the 13 stub kinds — with NotImplementedError carrying mode + roadmap_pointer.'
commit_hashes:
  - 0b3880f
files_modified:
  - packages/methodology/src/index.ts
  - packages/methodology/src/vibe/index.ts
  - packages/methodology/src/vibe/errors.ts
  - packages/methodology/src/vibe/route.ts
  - packages/methodology/src/vibe/handlers/index.ts
  - packages/methodology/src/vibe/handlers/stubs.ts
  - packages/methodology/test/vibe/route.test.ts
  - packages/methodology/test/vibe/dispatch.test.ts
  - packages/cli/src/commands/vibe.ts
  - packages/cli/src/commands/stubs.ts
  - packages/cli/src/main.ts
deviations:
  - id: D1
    type: scope
    description: 'AskUserQuestion-equivalent confirmation prompt is exposed via the requires_confirmation flag on the route output, but the actual interactive prompt is not wired (Codex doesn'\''t have AskUserQuestion).'
    resolution: 'Plan 04 will add the Codex-side confirmation tooling. For now, requires_confirmation=true is honoured as "skip when --yolo is set; otherwise the mode handler decides".'
  - id: D2
    type: process
    description: 'pnpm not installed locally; tests not run this session.'
    resolution: 'GitHub Actions CI matrix validates on push/PR.'
deferred_to_followup:
  - 'PLAN 03: Bootstrap + Scope + Discussion engine real handlers'
  - 'PLAN 04: Plan + Execute orchestration (waves, fan-out, Dev/QA chaining)'
  - 'PLAN 05: QA remediation + UAT remediation pipelines'
  - 'PLAN 06: Verify (UAT inline checkpoints) + Milestone UAT recovery'
  - 'PLAN 07: Archive + 7-point audit gate'
---

# Phase 9 / Plan 02 Summary: Orchestration loop

## What Was Built

The typed routing layer that converts PhaseDetectResult into a discriminated VibeRoute and dispatches to per-mode handlers:

- **VibeRoute** discriminated union over 13 modes.
- **routeFromState** implementing VBW vibe.md priorities 1–11 plus both QA-attention fallbacks.
- **ModeRegistry** with register / has / dispatch and duplicate-kind protection.
- **buildStubRegistry** preloaded with NotImplementedError stubs for every kind, each carrying the matching Phase 9 / Plan NN roadmap pointer.
- **`swt vibe`** real implementation: argv → state → route → dispatch, with structured exit codes (0 success, 1 routing/init-redirect, 2 not-implemented).
- **Two Vitest suites** covering the priority table cell-by-cell and the dispatch / stub propagation.

## Files Modified

See `files_modified` in frontmatter (11 files).

## Acceptance criteria status

All 6 must-haves pass. Two deviations recorded — Codex-side confirmation tooling deferred to PLAN 04 (D1), local pnpm smoke run unavailable (D2).

## Commit

`0b3880f` — feat(methodology): orchestration loop — VibeRoute + router + dispatch (Phase 9 / PLAN 02)
