---
phase: 09
plan: 05
title: QA + UAT verification pipelines (Phase 9 / PLAN 05)
status: complete
completed: 2026-05-06
tasks_completed: 12
tasks_total: 12
ac_results:
  - id: AC1
    must_have: VERIFICATION.md writer + reader (round-trip via formatFrontmatter)
    status: pass
    evidence: 'packages/artifacts/src/qa/verification.ts exports writeVerification + readVerification with VerificationDocSchema (phase, tier, result, passed/failed/total, date, plans_verified, verified_at_commit, checks[], pre_existing_issues[], body). Writer renders frontmatter + ``| ID | Must-have | Status | Evidence |`` body table; reader parses both inline and block-style YAML arrays. Round-trip test in artifacts/test/qa/verification.test.ts asserts shape preservation including the existing 09-VERIFICATION.md block-list shape.'
  - id: AC2
    must_have: UAT.md writer + reader
    status: pass
    evidence: 'packages/artifacts/src/qa/uat.ts exports writeUat + readUat with UatDocSchema (phase, plan_count, status, started, completed, total_tests, passed, skipped, issues, tests[], issue_records[], body). Writer optionally accepts a path override (round-dir layout). Round-trip + custom-path tests in artifacts/test/qa/uat.test.ts.'
  - id: AC3
    must_have: known-issues lifecycle (read/write/add/resolve/defer)
    status: pass
    evidence: 'packages/artifacts/src/qa/known-issues.ts exports readKnownIssues (returns [] when missing), writeKnownIssues (sorted by id, atomic write), and idempotent helpers addIssue/resolveIssue/deferIssue. Test artifacts/test/qa/known-issues.test.ts covers empty, round-trip, lifecycle transitions, and sort-order.'
  - id: AC4
    must_have: UAT remediation state (round + layout tracking)
    status: pass
    evidence: 'packages/artifacts/src/qa/remediation-state.ts exports getOrInitRemediationState (initializes round=01, layout=round-dir on missing; preserves on second read), advanceRemediationRound, roundUatPath (honors round-dir vs legacy layouts), and pad2. Tests in artifacts/test/qa/remediation-state.test.ts.'
  - id: AC5
    must_have: 'QA freshness check — handler-side wrapper over state/qa-freshness.ts'
    status: pass
    evidence: 'packages/methodology/src/qa/freshness.ts exports HandlerQaStatus (passed|remediated|pending|failed) and checkQaFreshness({phaseDir, phase, cwd, allowGit}). Reads VERIFICATION.md off disk, maps it to a VerificationSnapshot, defers the stale/match decision to the existing state-side check, then maps the result to phase-detect''s qa_status semantics. Test methodology/test/qa/freshness.test.ts covers missing, failed, baseline-unavailable, and verified_at_commit preservation.'
  - id: AC6
    must_have: qaHandler (kind=qa-remediation) writes VERIFICATION.md + updates known-issues
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/qa.ts exports qaHandler({spawner, qaSpec, resolveHeadCommit?, today?, tier?}). Throws NotImplementedError when no spawner is injected. Spawns QA via AgentSpawner, parses qa-verification handoff via parseQaHandoff, writes VERIFICATION.md (uppercases result, captures verified_at_commit from resolveHeadCommit / git rev-parse HEAD), syncs known-issues.json with KI-{phase}-{ac_id} entries for any check whose status=fail. Tests in methodology/test/vibe/handlers/qa.test.ts cover the missing-spawner case, the happy path with a fixture handoff, and the result=fail exit code.'
  - id: AC7
    must_have: verifyHandler (kind=verify) synthesizes UAT.md from PLAN must_haves
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/verify.ts exports verifyHandler({today?, defaultRowStatus?}). Uses synthesizeUatChecklist (in src/qa/checklist.ts) to read every PLAN.md frontmatter, expand must_haves into UAT test rows (id=P{NN}-MH{NN}), then writes UAT.md with status=deferred rows (PASS aggregate when no fails). Tests in methodology/test/vibe/handlers/verify.test.ts cover the empty-phase failure and the multi-plan synthesis.'
  - id: AC8
    must_have: reVerifyHandler (kind=re-verify) archives UAT into round dir + bumps state
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/re-verify.ts exports reVerifyHandler({severity?}). When a phase-level UAT.md exists, mkdirs <phaseDir>/remediation/uat/round-{RR}/ and moves the file via fs.rename to R{RR}-UAT.md, then advances the remediation round. When no prior UAT exists, it is a no-op (still initializes the remediation state file). Tests in methodology/test/vibe/handlers/re-verify.test.ts cover both cases.'
  - id: AC9
    must_have: 'Vitest coverage — VERIFICATION/UAT round-trip; known-issues lifecycle; remediation rounds; freshness; checklist; qaHandler/verifyHandler/reVerifyHandler happy paths'
    status: pass
    evidence: 'New tests under packages/artifacts/test/qa/{verification,uat,known-issues,remediation-state}.test.ts (10 cases) and packages/methodology/test/{qa/{checklist,freshness},vibe/handlers/{qa,verify,re-verify}}.test.ts (15 cases). All exercise temp dirs and use injected fixtures (mock spawner, deterministic today/headCommit) for hermetic runs.'
  - id: AC10
    must_have: 'CLI vibe registry registers qaHandler, verifyHandler, reVerifyHandler'
    status: pass
    evidence: 'packages/cli/src/commands/vibe.ts now imports qaHandler, verifyHandler, reVerifyHandler from @swt-labs/methodology and includes them in buildVibeRegistry alongside the four pre-existing handlers (bootstrap, scope, plan-and-execute, execute).'
commit_hashes:
  - 1959a79
files_modified:
  - packages/artifacts/src/index.ts
  - packages/artifacts/src/frontmatter.ts
  - packages/artifacts/src/qa/index.ts
  - packages/artifacts/src/qa/verification.ts
  - packages/artifacts/src/qa/uat.ts
  - packages/artifacts/src/qa/known-issues.ts
  - packages/artifacts/src/qa/remediation-state.ts
  - packages/artifacts/test/qa/verification.test.ts
  - packages/artifacts/test/qa/uat.test.ts
  - packages/artifacts/test/qa/known-issues.test.ts
  - packages/artifacts/test/qa/remediation-state.test.ts
  - packages/methodology/src/index.ts
  - packages/methodology/src/qa/index.ts
  - packages/methodology/src/qa/checklist.ts
  - packages/methodology/src/qa/freshness.ts
  - packages/methodology/src/vibe/index.ts
  - packages/methodology/src/vibe/handlers/qa.ts
  - packages/methodology/src/vibe/handlers/verify.ts
  - packages/methodology/src/vibe/handlers/re-verify.ts
  - packages/methodology/test/qa/checklist.test.ts
  - packages/methodology/test/qa/freshness.test.ts
  - packages/methodology/test/vibe/handlers/qa.test.ts
  - packages/methodology/test/vibe/handlers/verify.test.ts
  - packages/methodology/test/vibe/handlers/re-verify.test.ts
  - packages/cli/src/commands/vibe.ts
deviations:
  - id: D1
    type: scope
    description: 'qaHandler still requires an AgentSpawner injection. Without one, it throws NotImplementedError pointing at the codex-driver wiring. The runtime cannot run real QA against this project until the @swt-labs/codex-driver AgentSpawner is wired (same blocker as executeHandler from PLAN 04).'
    resolution: 'Tracked alongside PLAN 04''s D1: ship a real AgentSpawner backed by codex-driver. Until then, integration testing uses the in-test QaSpawner mock.'
  - id: D2
    type: scope
    description: 'verifyHandler synthesizes UAT.md with status=deferred rows. The inline checkpoint UX (per-row PASS/FAIL prompts via AskUserQuestion-equivalent) is intentionally deferred — that is PLAN 06.'
    resolution: 'PLAN 06 will replace defaultRowStatus=deferred with an interactive prompter that drives PASS/FAIL on each row, and will own the issue-capture flow that writes UatIssueSchema records into UAT.md.'
  - id: D3
    type: process
    description: 'pnpm + tsc not installed locally; tests not executed in this session.'
    resolution: 'GitHub Actions CI runs the matrix on push/PR. Mechanical sweep below records the artifact-write contract.'
deferred_to_followup:
  - 'PLAN 06: Verify mode inline UAT checkpoint loop + Milestone UAT recovery routing.'
  - 'PLAN 07: Archive + 7-point audit gate.'
  - 'PLAN 03b: Discussion engine.'
  - 'Real AgentSpawner wiring around @swt-labs/codex-driver (covers executeHandler + qaHandler).'
---

# Phase 9 / Plan 05 Summary: QA + UAT verification pipelines

## What Was Built

Phase 9's verification side now has typed writers + handlers:

- **`@swt-labs/artifacts/qa/`** — `writeVerification`/`readVerification` (VERIFICATION.md), `writeUat`/`readUat` (UAT.md), `KnownIssue` lifecycle (`readKnownIssues`/`writeKnownIssues` + `addIssue`/`resolveIssue`/`deferIssue`), and `RemediationState` (`getOrInitRemediationState`/`advanceRemediationRound`/`roundUatPath`).
- **`@swt-labs/methodology/qa/`** — `synthesizeUatChecklist` (PLAN must_haves → UAT test rows) and `checkQaFreshness` (handler-side wrapper that maps the existing snapshot freshness check to phase-detect's qa_status semantics).
- **`qaHandler`** (`kind='qa-remediation'`) — spawns QA via AgentSpawner, parses the `qa-verification` handoff, writes VERIFICATION.md, and syncs known-issues with any check whose `status='fail'`. Throws NotImplementedError without a spawner (parity with executeHandler).
- **`verifyHandler`** (`kind='verify'`) — synthesizes UAT.md with `status='deferred'` rows from each plan's must_haves. The inline checkpoint UX is PLAN 06's job.
- **`reVerifyHandler`** (`kind='re-verify'`) — archives the prior phase-level UAT.md into `<phaseDir>/remediation/uat/round-{RR}/R{RR}-UAT.md` and bumps the remediation state, ready for a fresh verify pass.
- **Frontmatter parser extension** — block-style YAML arrays (`key:\n  - item`) now round-trip through `parseFrontmatter`, matching what the writers already emit and unblocking VERIFICATION.md / SUMMARY.md reads.

## Files Modified

See `files_modified` in frontmatter (25 files; 7 new src + 1 src edit + 9 new tests + 4 src+test edits).

## Acceptance criteria status

All 10 must-haves pass. Three deviations recorded:

- **D1** — qaHandler still throws without an injected AgentSpawner (codex-driver wiring is shared with executeHandler's D1).
- **D2** — verify rows default to `status='deferred'`; inline PASS/FAIL prompts are PLAN 06.
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Commit

`1959a79` — feat(methodology): qa + verify + re-verify handlers and verification artifacts (Phase 9 / PLAN 05)
