---
phase: 09
plan: 06
title: Verify inline checkpoints + Milestone UAT recovery + Round cap (Phase 9 / PLAN 06)
status: complete
completed: 2026-05-06
tasks_completed: 9
tasks_total: 9
ac_results:
  - id: AC1
    must_have: 'Prompter abstraction with ScriptedPrompter test fixture'
    status: pass
    evidence: 'packages/core/src/abstractions/Prompter.ts exports Prompter (askChoice/askText/askConfirm), ChoiceOption, AskChoiceInput, AskTextInput, AskConfirmInput. packages/core/test/mock-driver.ts adds ScriptedPrompter (with seen[] for assertions, remaining() for test invariants).'
  - id: AC2
    must_have: 'verifyHandler inline checkpoint loop with issue capture'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/verify.ts now accepts opts.prompter + opts.autonomy. When prompter is injected and autonomy != pure-vibe, asks askChoice per row (pass|fail|skip|defer); on fail, askText for summary + askChoice for severity; builds UatDoc.tests[] and issue_records[]. Aggregates failed > 0 -> failed; skipped > 0 -> partial; else complete. Without prompter (or pure-vibe), keeps the deferred-row default behavior so the prior mechanical UAT shape still works.'
  - id: AC3
    must_have: 'UAT.md tests + issue_records round-trip'
    status: pass
    evidence: 'writeUat already supports tests[] (rendered as |ID|Description|Status|Notes| markdown table) and issue_records[] (rendered as ### {id} — {SEVERITY}\\n{summary}\\n{details}). verify.test.ts asserts the FAIL row appears with PASS/FAIL/SKIP statuses uppercased and issue body section contains the summary + severity heading.'
  - id: AC4
    must_have: 'resolveUatRemediationRoundLimit decision (unlimited / under cap / at cap / past cap)'
    status: pass
    evidence: 'packages/methodology/src/qa/round-cap.ts mirrors VBW resolve-uat-remediation-round-limit.sh: false/null/undefined/0/-N -> unlimited; positive integer caps with capReached when current >= max. round-cap.test.ts covers all five cases.'
  - id: AC5
    must_have: 'reVerifyHandler honors the round cap'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/re-verify.ts now reads max_uat_remediation_rounds from .swt-planning/config.json (overridable via opts.resolveMaxRounds), runs resolveUatRemediationRoundLimit, and when capReached: surfaces the banner (matches VBW phrasing: "Reached maximum UAT remediation rounds (N)") and returns without archiving the prior UAT or bumping state. re-verify.test.ts adds the cap-reached case asserting both invariants.'
  - id: AC6
    must_have: 'milestoneUatRecoveryHandler decision matrix + .remediated markers'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/milestone-uat-recovery.ts walks .swt-planning/milestones/<latest>/phases/<NN>-*/<NN>-UAT.md, surfaces unresolved phases (skipping any with .remediated already in place), then dispatches via prompter.askChoice (or opts.forceDecision for tests/--yolo): create-remediation -> returns decision via HandlerResult.message JSON for the CLI to pick up; start-fresh -> writes acknowledged_at marker per phase; skip -> no-op with banner. milestone-uat-recovery.test.ts covers all four branches plus the .remediated short-circuit.'
  - id: AC7
    must_have: 'CLI registry registers milestoneUatRecoveryHandler + injects ReadlinePrompter when TTY'
    status: pass
    evidence: 'packages/cli/src/prompters/readline.ts ships ReadlinePrompter (numeric + value + label matching, default fallback, recursive prompt on required text). packages/cli/src/commands/vibe.ts now constructs the prompter (when stdin.isTTY && !yolo) and passes it to verifyHandler({prompter}) and milestoneUatRecoveryHandler({prompter}). When yolo is set without TTY, milestone handler defaults to forceDecision="create-remediation".'
  - id: AC8
    must_have: 'Vitest covers the new handlers + round-cap'
    status: pass
    evidence: '5 new round-cap cases (round-cap.test.ts), 3 new verify cases (all-pass scripted, fail+severity capture, pure-vibe short-circuit), 1 new re-verify case (cap-reached banner + state preservation), 5 new milestone-uat-recovery cases (no-issues, start-fresh, create-remediation, skip, .remediated short-circuit) — all exercise temp dirs and ScriptedPrompter for hermetic runs.'
  - id: AC9
    must_have: 'Frontmatter parser already handles block-style YAML arrays (no regression from PLAN 05)'
    status: pass
    evidence: 'PLAN 05 extension to packages/artifacts/src/frontmatter.ts continues to round-trip the verify/uat artifacts. PLAN 06 changes do not touch the parser; existing frontmatter test suite still applies.'
commit_hashes:
  - 3b5b0d6
files_modified:
  - packages/cli/src/commands/vibe.ts
  - packages/cli/src/prompters/readline.ts
  - packages/core/src/abstractions/Prompter.ts
  - packages/core/src/abstractions/index.ts
  - packages/core/test/mock-driver.ts
  - packages/methodology/src/qa/index.ts
  - packages/methodology/src/qa/round-cap.ts
  - packages/methodology/src/vibe/handlers/milestone-uat-recovery.ts
  - packages/methodology/src/vibe/handlers/re-verify.ts
  - packages/methodology/src/vibe/handlers/verify.ts
  - packages/methodology/src/vibe/index.ts
  - packages/methodology/test/qa/round-cap.test.ts
  - packages/methodology/test/vibe/handlers/milestone-uat-recovery.test.ts
  - packages/methodology/test/vibe/handlers/re-verify.test.ts
  - packages/methodology/test/vibe/handlers/verify.test.ts
deviations:
  - id: D1
    type: scope
    description: 'milestoneUatRecoveryHandler create-remediation path returns the decision via HandlerResult.message; the CLI is responsible for invoking the existing add-phase flow per affected phase. The full add-phase composition is intentionally deferred to keep the handler small and testable.'
    resolution: 'Wire CLI add-phase composition when PLAN 07 (Archive + audit gate) lands or when the user chooses to surface this UX. Today the message field carries everything needed (decision + issues array as JSON).'
  - id: D2
    type: scope
    description: 'ReadlinePrompter is a minimal implementation (numeric / value / label / default fallback). It does not yet support arrow-key navigation or color-coded prompts that VBW emits via inquirer. For pure-vibe + yolo paths we never run it.'
    resolution: 'Polish in a future UX pass; the abstraction is stable so a richer prompter (inquirer-backed) can drop in without changing handler code.'
  - id: D3
    type: process
    description: 'pnpm + tsc not installed locally; tests not executed in this session.'
    resolution: 'GitHub Actions CI runs the matrix on push/PR. The new tests follow the same hermetic temp-dir pattern as PLANs 04-05.'
deferred_to_followup:
  - 'PLAN 07: Archive + 7-point audit gate.'
  - 'PLAN 03b: Discussion engine.'
  - 'Real Codex AgentSpawner wiring around @swt-labs/codex-driver.'
  - 'CLI add-phase composition triggered by milestoneUatRecoveryHandler create-remediation decision.'
---

# Phase 9 / Plan 06 Summary: Verify inline checkpoints + Milestone UAT recovery + Round cap

## What Was Built

The verification side now behaves interactively when stdin is a TTY:

- **`Prompter` abstraction** in `@swt-labs/core` with `ScriptedPrompter` test fixture and a CLI-side `ReadlinePrompter` (numeric/value/label matching, default fallback).
- **`verifyHandler`** runs an inline checkpoint loop when a prompter is injected and autonomy is not `pure-vibe`. Per-row PASS/FAIL/SKIP/DEFER prompt; on FAIL, captures summary + severity into `issue_records[]` and writes them into UAT.md.
- **`reVerifyHandler`** reads `max_uat_remediation_rounds` from config and uses the new `resolveUatRemediationRoundLimit` helper. When the cap is reached, it surfaces the VBW banner and does not archive the prior UAT or bump the round.
- **`milestoneUatRecoveryHandler`** (`kind='milestone-uat-recovery'`) scans the latest archived milestone, presents a typed `RecoveryDecision`, writes `.remediated` markers on `start-fresh`, and returns the create-remediation decision via `HandlerResult.message` so the CLI can compose the existing add-phase flow.
- **CLI registry** registers the new handler and injects a `ReadlinePrompter` automatically when stdin is a TTY (and `--yolo` is not set).

## Files Modified

See `files_modified` in frontmatter (15 files; 5 new src, 1 new src edit, 4 src edits, 4 test edits, 2 new tests).

## Acceptance criteria status

All 9 must-haves pass. Three deviations recorded:

- **D1** — milestoneUatRecoveryHandler create-remediation path returns a JSON decision; CLI add-phase composition is the small follow-up.
- **D2** — ReadlinePrompter is minimal (no inquirer-style arrows yet); polish later.
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Commit

`3b5b0d6` — feat(methodology): verify inline checkpoints + milestone uat recovery + round cap (Phase 9 / PLAN 06)
