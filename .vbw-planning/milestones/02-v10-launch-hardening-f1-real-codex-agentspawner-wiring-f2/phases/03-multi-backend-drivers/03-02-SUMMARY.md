---
phase: 03
plan: 03-02
title: ClaudeCodeHookHost — 12-event taxonomy mapping to SWT's 6 generic events
status: complete
completed: 2026-05-07
tasks_completed: 2
tasks_total: 2
commit_hashes:
  - c4b47b4
deviations:
  - "Plan 03-02 frontmatter referred to the registration method as `subscribe(event, handler)` but the actual HookHost contract from @swt-labs/core declares `on(event, handler)`. Implementation matches the contract (`on`); plan body's narrative-style description used `subscribe` loosely. Process-exception: no plan amendment needed because the contract is the authoritative source — the implementation is correct, not the plan's narrative."
pre_existing_issues: []
ac_results:
  - criterion: "@swt-labs/claude-code-driver exports a ClaudeCodeHookHost class implementing the HookHost contract from @swt-labs/core"
    verdict: "pass"
    evidence: "packages/claude-code-driver/src/hooks/host.ts:51 declares `class ClaudeCodeHookHost implements HookHost`. Barrel re-exports through src/hooks/index.ts and src/index.ts."
  - criterion: "the 12 Claude Code lifecycle events are documented as a typed enum and mapped onto SWT's 6 generic events"
    verdict: "pass"
    evidence: "host.ts ClaudeCodeHookEvent type union has all 12 events. CC_TO_SWT_EVENT_MAP covers the 7 mapped events (5 direct + 2 merged → stop). 5 events stay unmapped (Notification, NotificationVariant, PreCompact, PreCompactRequest, PluginEvent) — observable but no SWT handler fires."
  - criterion: "events Claude Code emits but SWT doesn't model are observable via the underlying CC stream but do not fire SWT-side handlers"
    verdict: "pass"
    evidence: "host.test.ts case `routeFromClaudeCode for unmapped event (Notification) returns undefined and fires no handler` asserts both: returned outcome is undefined; subscribed handlers across all SWT events are not called."
  - criterion: "registering a handler via on(event, handler) returns a HookSubscription whose unsubscribe() detaches idempotently"
    verdict: "pass"
    evidence: "host.test.ts case `unsubscribe removes the handler and is idempotent on re-call` calls unsubscribe twice and asserts the handler is not invoked on subsequent dispatch."
  - criterion: "dispatch(context) routes to all subscribed handlers for the matching SWT event; aggregated outcome follows block-precedes-allow semantics"
    verdict: "pass"
    evidence: "host.test.ts cases `block-precedes-allow` (3 handlers — first allow, middle block, last allow → outcome is block) and `observe-fallthrough` (2 handlers — allow + observe → outcome is observe) both pass. The aggregation logic in host.ts's dispatch loops through all handlers, captures the first block, tracks observe-seen, and returns the right priority."
---

ClaudeCodeHookHost ships. F2's hook event taxonomy success criterion is met: the 12 documented Claude Code lifecycle events map onto SWT's 6 generic events via the `CC_TO_SWT_EVENT_MAP` table, with documented coverage gaps (Notification family, PreCompact*, PluginEvent) that stay observable on the CC stream but don't fire SWT-side handlers.

## What Was Built

- **`packages/claude-code-driver/src/hooks/host.ts`** — `class ClaudeCodeHookHost implements HookHost` plus the `ClaudeCodeHookEvent` 12-variant type union and `CC_TO_SWT_EVENT_MAP` mapping table.
- **`packages/claude-code-driver/src/hooks/index.ts`** — barrel.
- **`packages/claude-code-driver/src/index.ts`** — append `export * from './hooks/index.js'` to package barrel.
- **`packages/claude-code-driver/test/hooks/host.test.ts`** — 7 test cases covering the full contract.

## Files Modified

- `packages/claude-code-driver/src/hooks/host.ts` (new — 130 LOC including types, map, class)
- `packages/claude-code-driver/src/hooks/index.ts` (new barrel)
- `packages/claude-code-driver/src/index.ts` (append hooks barrel export)
- `packages/claude-code-driver/test/hooks/host.test.ts` (new — 7 cases)

## CC_TO_SWT_EVENT_MAP — the authoritative table

| Claude Code event | SWT event | Notes |
|-------------------|-----------|-------|
| `SessionStart` | `session_start` | direct |
| `UserPromptSubmit` | `user_prompt_submit` | direct |
| `PreToolUse` | `pre_tool_use` | direct |
| `PostToolUse` | `post_tool_use` | direct |
| `Stop` | `stop` | direct |
| `SessionEnd` | `stop` | merged — both terminate the session |
| `SubagentStop` | `stop` | merged — subagent completion terminates that subagent |
| `Notification` | (unmapped) | observable only |
| `NotificationVariant` | (unmapped) | observable only |
| `PreCompact` | (unmapped) | observable only |
| `PreCompactRequest` | (unmapped) | observable only |
| `PluginEvent` | (unmapped) | reserved for marketplace plugins; observable only |

`permission_request` has no direct CC source — it would be synthesized when CC emits a permission decision request envelope. Plan 03-02 does not synthesize this (no need yet); it is documented as a deferred concern in the host.ts JSDoc.

## Deviations

See frontmatter `deviations:`. One:

1. **Method name mismatch in plan narrative** — Plan 03-02 frontmatter and body referred to the registration method as `subscribe(event, handler)`, but the actual HookHost contract from `@swt-labs/core` declares `on(event, handler)`. Implementation matches the contract. No plan amendment needed because the contract is the authoritative source.

## Verification

1. ✅ `pnpm --filter @swt-labs/claude-code-driver typecheck` exits 0
2. ✅ `pnpm vitest run packages/claude-code-driver/test/hooks/host.test.ts` — 7/7 pass
3. ✅ Full claude-code-driver test surface: 20/20 pass (Plan 03-01's 13 + Plan 03-02's 7)
4. ✅ The mapping table is exported as the source of truth — Plan 05 (F7 hook taxonomy expansion) can extend the SWT-side enum without duplicating this map

## Next

Plan 03-03 (OllamaAgentSpawner) is independent of 03-01/03-02 and lifts directly off the same AgentSpawner contract pattern. Running it next as the sibling driver implementation before Plan 03-04 (Ollama sandbox-mode wrapping) and Plan 03-05 (driver dispatch wiring).
