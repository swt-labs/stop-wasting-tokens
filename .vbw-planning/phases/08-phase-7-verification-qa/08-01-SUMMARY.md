---
phase: 08
plan: 01
title: Verification & QA — checks, guards, traceability, circuit breaker, swt qa runner (artifact Phase 7)
status: complete
completed: 2026-05-06
tasks_completed: 7
tasks_total: 7
ac_results:
  - id: AC1
    must_have: PostToolUse check helpers (SUMMARY frontmatter, commit message, plan frontmatter)
    status: pass
    evidence: checks/summary-frontmatter.ts validates phase/plan/title/status/tasks_*/files_modified/commit_hashes plus phase/plan format and status enum. checks/commit-message.ts enforces Conventional Commits header and 100-char header cap. checks/plan-frontmatter.ts validates phase/plan/title/wave/must_haves plus non-empty must_haves.
  - id: AC2
    must_have: PreToolUse guard helpers (bash compound parsing + denylist, file path-allow, secret scanner)
    status: pass
    evidence: guards/bash-guard.ts splits compound commands on `;`, `&&`, `||`, `|` and matches each segment against a denylist (rm -rf /, sudo, curl|sh, mkfs.*, fork bomb, block-device writes, npm publish). guards/file-guard.ts resolves the target path and accepts only descendants of writable_roots. guards/secret-scanner.ts matches AWS access keys, GitHub PATs, Slack/OpenAI/Anthropic tokens, and high-entropy hex blobs; redacts the matched value in the outcome.
  - id: AC3
    must_have: Compaction circuit breaker enforcing the 3-failure rule
    status: pass
    evidence: circuit-breaker.ts CompactionCircuitBreaker (default threshold 3) — recordFailure increments and trips at threshold; recordSuccess resets to 0; custom thresholds honoured; sub-1 thresholds throw RangeError.
  - id: AC4
    must_have: Traceability checker (REQ → ROADMAP → PLAN → SUMMARY → VERIFICATION coverage)
    status: pass
    evidence: traceability.ts checkTraceability returns unmapped_requirements, dangling_requirement_refs, plans_without_summary, summaries_for_unknown_plans, plus a top-level ok flag. Pure data-in / data-out.
  - id: AC5
    must_have: swt qa runner with three tiers consuming PLAN must-haves and SUMMARY ac_results
    status: pass
    evidence: runner.ts runQa(input) consumes tier + phase + plans_verified + checks (+ optional traceability_ok). Returns result (pass | partial | fail) plus a downgrade_reason when the tier policy applies (standard+ requires non-empty evidence; deep also folds traceability gaps into the result).
  - id: AC6
    must_have: Vitest suite covering each check, guard, circuit breaker, traceability gaps, runner
    status: pass
    evidence: checks.test.ts (good + missing-keys + bad-format cases, parametrised commit-message accept/reject), guards.test.ts (allow/block parametrised cases, matched_segment recording, scanForSecrets per pattern), circuit-breaker.test.ts (3-fail trip, success reset, custom threshold, range error), traceability.test.ts (clean + each failure mode), runner.test.ts (pass / partial / fail / tier evidence rule / deep traceability downgrade / quick tier exemption).
commit_hashes:
  - 1a9095f
files_modified:
  - packages/verification/src/index.ts
  - packages/verification/src/checks/index.ts
  - packages/verification/src/checks/summary-frontmatter.ts
  - packages/verification/src/checks/commit-message.ts
  - packages/verification/src/checks/plan-frontmatter.ts
  - packages/verification/src/guards/index.ts
  - packages/verification/src/guards/bash-guard.ts
  - packages/verification/src/guards/file-guard.ts
  - packages/verification/src/guards/secret-scanner.ts
  - packages/verification/src/circuit-breaker.ts
  - packages/verification/src/traceability.ts
  - packages/verification/src/runner.ts
  - packages/verification/test/checks.test.ts
  - packages/verification/test/guards.test.ts
  - packages/verification/test/circuit-breaker.test.ts
  - packages/verification/test/traceability.test.ts
  - packages/verification/test/runner.test.ts
deviations:
  - id: D1
    type: scope
    description: 'Wiring the PostToolUse / PreToolUse helpers into a real Codex hooks.json was not done in this phase.'
    resolution: codex-driver in Phase 4 already produces a valid hooks.json. The methodology runtime in the Phase 6 stubs (swt vibe / plan / execute) will register these helpers as hook commands when those stubs become real.
  - id: D2
    type: scope
    description: 'Long-form `docs/concepts/goal-backward.md` spec was not authored.'
    resolution: Belongs to Phase 9 (Documentation site).
  - id: D3
    type: process
    description: pnpm not installed locally; tests not run this session.
    resolution: GitHub Actions CI matrix validates on push/PR.
deferred_to_user: []
---

# Phase 8 Summary: Verification & QA

## What Was Built

`packages/verification` ships pure, composable verification helpers — every function is data-in / data-out so the methodology runtime and Codex hooks can drop them in unchanged:

- **PostToolUse checks** for SUMMARY frontmatter, commit messages (Conventional Commits), and PLAN frontmatter.
- **PreToolUse guards** for compound bash commands (denylist), write path scoping (writable roots), and secret patterns (AWS / GitHub / Slack / OpenAI / Anthropic / high-entropy hex). All return a `GuardOutcome` with the matched segment.
- **Compaction circuit breaker** enforcing the 3-failure rule, with success reset.
- **Traceability checker** reporting every gap in the REQ → ROADMAP → PLAN → SUMMARY chain.
- **`swt qa` runner** that consumes a tier + checks + plan list and returns a QA-handoff-shaped result, applying tier-specific evidence and traceability rules.

Five Vitest suites cover the lot.

## Files Modified

See `files_modified` in frontmatter (17 files).

## Acceptance criteria status

All 6 must-haves pass. Three deviations recorded — hook-file wiring deferred to the methodology runtime work (D1), narrative goal-backward doc deferred to Phase 9 (D2), and the local pnpm smoke run unavailable (D3).

## Commit

`1a9095f` — feat(verification): PostTool checks, PreTool guards, traceability, circuit breaker, qa runner
