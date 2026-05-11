---
adr: 002
title: Result protocol via Extension custom tool
status: Proposed
decided: 2026-05-11
pr: M1 PR-02 (Proposed) → M1 PR-09 (promotes to Accepted)
supersedes: TDD2 §22.2
---

# ADR-002 — Result protocol via Extension custom tool

**Status:** Proposed (promotes to Accepted when M1 Plan 01-02 PR-09 lands the implementation)

## Context

TDD.md cited `shouldStopAfterTurn` and `report_result` as Pi primitives. Verified
against the actual Pi docs (`pi.dev/docs/latest`, retrieved during recon) they
don't exist. We need a way for a dispatched agent to:

1. Tell the orchestrator the task is done.
2. Hand off a structured result envelope (status, summary, files_changed,
   must_haves verdicts, optional blockers).
3. Optionally hint that no follow-up LLM call is needed (saves a turn's worth
   of tokens after the agent has nothing left to say).

## Decision

Use Pi's documented Extension API (`pi.registerTool`) to register a
`swt_report_result` custom tool. The tool:

- Returns `{ terminate: true }` so Pi skips the follow-up LLM call.
- In its `execute(toolCallId, params, signal, onUpdate, ctx)`, persists the
  envelope by calling **closure-captured `pi.appendEntry`** (NOT `ctx.appendEntry`
  — that property does not exist on Pi's `ExtensionContext`).
- Schema-validates the envelope against `TaskResultSchema` (Zod) at the harvest
  boundary; malformed envelopes surface as harvest errors, not as silently
  acceptable results.

A defensive `agent_end` hook writes a placeholder result if the agent ended
without calling the tool. The orchestrator treats placeholder results as
`status: failed` with a `protocol-violation` blocker.

## Consequences

Easier:
- Uses documented Pi primitives (no invented API).
- Result envelope is durable on disk (Pi `custom` session entry), surviving
  orchestrator crashes — the harvester re-reads from the session file on
  resume.
- Schema is Zod-validated at the harvest boundary; the contract is testable
  in isolation (no Pi process needed).

Harder:
- One extra extension to load per session; one extra tool in the role's tool
  list. Negligible token overhead.
- Agents must learn to call the tool; the role system prompts include explicit
  "call swt_report_result before stopping" instructions.
- The closure-captured `pi.appendEntry` pattern is non-obvious; the helper
  function in `runtime/extensions/result-protocol.ts` documents it inline
  (lands in Plan 01-02 PR-09).

## Lifecycle

PR-02 (this PR) drafts the ADR as **Proposed**. M1 Plan 01-02 PR-09 ships the
implementing code (`packages/runtime/src/extensions/result-protocol.ts`,
`packages/orchestration/src/result-harvest.ts`, the first end-to-end cassette
test) — the merge of that PR promotes this ADR's status to **Accepted** with
`pr: M1 PR-09`.
