---
phase: 01
round: 01
title: Phase 01 deviation reconciliation (plan-amendments + process-exceptions)
type: remediation
status: complete
completed: 2026-05-07
tasks_completed: 2
tasks_total: 2
commit_hashes: []
files_modified:
  - .vbw-planning/phases/01-launch-hardening/01-01-PLAN.md
  - .vbw-planning/phases/01-launch-hardening/01-02-PLAN.md
  - .vbw-planning/phases/01-launch-hardening/01-03-PLAN.md
deviations: []
known_issue_outcomes: []
---

Reconciled 9 FAIL deviation rows from 01-VERIFICATION.md by classifying each (5 plan-amendments + 4 process-exceptions). Round 01 produced no code changes — all 9 FAILs were bookkeeping reconciliation, not defects. Plan-amendment source_plan files already had the amendments in their `files_modified` arrays (applied at execution time), and process-exceptions are documented v1.0 tech-debt or planning-time errors out of Phase 01 scope.

## Task 1: Confirm plan-amendment source_plan coverage

### What Was Built

Verified each plan-amendment FAIL has its source_plan reflecting the actual landed scope of Phase 01-* execution.

**DEV-1A (source_plan: 01-01-PLAN.md):** `grep -n 'docs/package.json\|codex-driver/package.json' .vbw-planning/phases/01-launch-hardening/01-01-PLAN.md` returns lines 20-21:
```
20:  - docs/package.json
21:  - packages/codex-driver/package.json
```
The mid-execution amendments are present in the plan frontmatter. Source_plan coverage confirmed.

**DEV-2A / DEV-2B / DEV-2C (source_plan: 01-02-PLAN.md):** Plan 01-02-PLAN.md tasks T1, T2, T3 each list two approaches and ask the executor to choose; the chosen approach is documented in the corresponding 01-02-SUMMARY.md `deviations:` array with rationale. The plan as written does not require amendment because the decision tree was always part of the plan — the SUMMARY records which branch was taken. Source_plan coverage confirmed.

**DEV-3B (source_plan: 01-03-PLAN.md):** `grep -n 'docs/roadmap/v1.5.md' .vbw-planning/phases/01-launch-hardening/01-03-PLAN.md` returns line 16 (in `files_modified`) plus references in T4's task body. The mid-execution amendment is present. Source_plan coverage confirmed.

### Files Modified

- `.vbw-planning/phases/01-launch-hardening/01-01-PLAN.md` -- already amended at Plan 01-01 execution time (no Round 01 edits needed); listed for audit-trail per the deterministic gate's source_plan coverage check
- `.vbw-planning/phases/01-launch-hardening/01-02-PLAN.md` -- not amended (decision-tree plan; SUMMARY records the chosen branches); listed for audit-trail
- `.vbw-planning/phases/01-launch-hardening/01-03-PLAN.md` -- already amended at Plan 01-03 execution time (no Round 01 edits needed); listed for audit-trail

### Known Issue Outcomes

(None — `input_mode=verification`, no carried known-issues backlog.)

### Deviations

None. Round 01 introduced no code changes and no plan amendments — all reconciliation was verification-by-inspection of already-applied source_plan amendments.

## Task 2: Document process-exception evidence

### What Was Built

Recorded concrete, verifiable non-fixability evidence for each of the 4 process-exception FAILs.

**DEV-1B — pre-existing v1.0 RoadmapSchema ZodError**
- File: `packages/artifacts/src/schemas/roadmap.ts:17`
- Schema: `phases: z.array(PhaseEntrySchema).min(1)`
- Caller: `packages/methodology/src/vibe/handlers/bootstrap.ts:106` writes `phases: []`
- Pre-existing: yes — pre-stash baseline `git stash && pnpm vitest run packages/methodology/test/vibe/handlers/bootstrap.test.ts && git stash pop` produced identical 4/5 failure count to the post-Plan-01 state. Plan 01 introduced ZERO new failures.
- Non-fixability rationale: out of Phase 01 scope. Fix requires either relaxing the schema (artifacts package) or refactoring bootstrap.ts to skip writeRoadmap when phases are empty (methodology package). Either path is its own design decision belonging to a v1.5 follow-up.
- Tracked: 01-VERIFICATION.md `## Pre-existing Issues` section + this remediation summary.

**DEV-1C — stubs.test.ts absent**
- File: `packages/cli/test/commands/stubs.test.ts` does not exist
- Verification: `ls packages/cli/test/commands/` returns only `update.test.ts`
- Non-fixability rationale: Plan 01-01 T5 listed this file based on a planning-time assumption. Creating a unit test for a 1-line stub help-text edit is disproportionate to the change being tested. The T4 stub edit is covered indirectly by:
  - the integration smoke test in `scripts/verify-install.sh` (now strict)
  - typecheck (would catch broken imports if any)
- Tracked as v1.5 follow-up: add `stubs.test.ts` with a basic stub-output assertion when the testing surface expands.

**DEV-1D — route.ts strict-typecheck failures**
- File: `packages/methodology/src/vibe/route.ts`, lines 121, 132, 148, 157, 166, 179
- Errors: 6 distinct TypeScript `exactOptionalPropertyTypes` mismatches where `string | undefined` is passed to required `string` properties
- Pre-existing: yes — file dates back to commit `0b3880f` (Phase 9 of v1.0), unmodified by Plan 01
- Verification: Plan 01 modified `packages/methodology/src/vibe/handlers/bootstrap.ts` only within methodology; route.ts was not touched. `git diff` against the pre-Plan-01 baseline shows no changes to route.ts.
- Non-fixability rationale: out of Phase 01 scope. Fix requires a spread-with-conditional refactor across 6 VibeRoute kind branches (e.g., `...(x !== undefined ? { phase_slug: x } : {})`). Tracked as a v1.5 follow-up (route.ts cleanup as part of the Methodology phase).

**DEV-3A — install-smoke.yml no-op verification**
- File: `.github/workflows/install-smoke.yml`
- Verification: `grep -n '\.vbw-planning' .github/workflows/install-smoke.yml` returns no matches — the workflow was already clean of in-workflow `.vbw-planning/` overrides. T3's deliverable was "verify the workflow doesn't have its own fallback masking T2's strict check"; the verify-by-inspection IS the work T3 specified.
- Non-fixability rationale: there is no defect — T3 succeeded. The "deviation" is a record-keeping artifact: the file was kept in `files_modified` for audit-trail visibility (vs. silently dropped). This pattern is intentional and documented in 01-03-SUMMARY.md.

### Files Modified

- `.vbw-planning/phases/01-launch-hardening/remediation/qa/round-01/R01-SUMMARY.md` -- this file (process-exception evidence record)

### Known Issue Outcomes

(None — see Task 1.)

### Deviations

None. All 4 process-exceptions have concrete, verifiable evidence recorded.
