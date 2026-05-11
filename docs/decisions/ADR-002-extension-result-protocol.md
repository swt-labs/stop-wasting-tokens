---
adr: 002
title: Result protocol via Extension custom tool
status: Accepted
decided: 2026-05-11
accepted: 2026-05-11
pr: M1 PR-09
proposed_pr: M1 PR-02
supersedes: TDD2 §22.2
related: ADR-001
---

# ADR-002 — Result protocol via Extension custom tool

**Status:** Accepted (promoted by M1 Plan 01-02 PR-09 — implementing code shipped in `packages/runtime/src/extensions/result-protocol.ts`, `packages/runtime/src/extensions/journal.ts`, `packages/orchestration/src/result-harvest.ts`, with the closure-captured `pi.appendEntry` invariant encoded in the structural type `PiExtensionContext` (no `appendEntry` field) so `ctx.appendEntry(...)` is a TS error)

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

PR-02 drafted the ADR as **Proposed**. M1 Plan 01-02 PR-09 (this commit)
promotes it to **Accepted** by shipping:

- `packages/runtime/src/extensions/result-protocol.ts` — Pi Extension factory.
  Registers the `swt_report_result` tool with a JSON-Schema parameter shape +
  Zod runtime validator at the `execute` trust boundary. Calls
  closure-captured `pi.appendEntry('swt-task-result', enriched)` and returns
  `{ terminate: true }`. A defensive `agent_end` hook writes a placeholder
  `protocol-violation` result when the agent never calls the tool.
- `packages/runtime/src/extensions/pi-types.ts` — local structural mirror of
  Pi's `ExtensionAPI` + `ExtensionContext`. `PiExtensionContext` intentionally
  has NO `appendEntry` field; this makes the closure-only invariant a TS
  error at the call site, not a runtime hazard.
- `packages/runtime/src/extensions/journal.ts` — companion extension that
  mirrors mapped SwtEvents into `.swt-planning/journal/<UTC-day>.jsonl`. M3
  will read these for crash recovery.
- `packages/orchestration/src/result-harvest.ts` — harvester
  (`harvestTaskResult(filePath)`, `harvestTaskResultFromEntries(entries)`)
  that reads the LAST `swt-task-result` custom entry and validates against
  `TaskResultSchema`. Throws `MissingTaskResultError` when no entry exists.
- `packages/orchestration/src/dispatcher.ts` — adds `HarvestStrategy`
  (`'stub' | 'entries' | 'file'`) so callers can drive harvest from
  synthetic entries, in-process Pi sessions, or out-of-process JSONL files.
- Integration test `packages/orchestration/test/dispatcher.int.test.ts` —
  exercises the full path with synthetic entries (always on) + a
  cassette-gated end-to-end assertion (activates when `scout-search-codebase.jsonl`
  lands). Schema validation runs on every path.

The closure-captured-`pi.appendEntry` invariant is locked in three ways:

1. **Compile time** — `PiExtensionContext` has no `appendEntry` field; the
   TypeScript compiler rejects `ctx.appendEntry(...)`.
2. **Test time** — `result-protocol.test.ts` asserts `'appendEntry' in ctx`
   is `false` for the structural context shape, and that the tool's
   `execute()` increments `pi.appendEntry`'s call count (not the context's).
3. **Doc time** — this ADR + the inline comments in `result-protocol.ts`
   document the invariant so a future contributor cannot silently regress
   it via a workaround.
