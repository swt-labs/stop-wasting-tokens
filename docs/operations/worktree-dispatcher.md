# Worktree dispatcher

Operator-facing reference for the M3 worktree dispatcher primitives per TDD2 §9.

> **Status (M3 PR-22):** `WorktreeManager` lifecycle FSM ships standalone. Claim-registry, DAG resolver, lock-files, and per-worktree Pi session wiring land in subsequent PRs in Plan 03-01 + the deferred session-activation follow-up. Plan 03-02 ships the dashboard panel + chaos suite + cleanup verb + Windows path discipline on top.

## What lands at PR-22

`packages/orchestration/src/worktree-manager.ts` ships the lifecycle FSM that owns state transitions for parallel-task worktrees created under `.swt-planning/parallel/wt-<taskId>/`. Each transition emits a journal entry to `.swt-planning/journal/wt-<taskId>.jsonl` (line-delimited JSON) for forensics + dashboard streaming.

## Lifecycle states

| State            | Reached via                           | Meaning                                                                                    |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `created`        | `create(taskId, baseRef)`             | `git worktree add` succeeded; worktree directory exists.                                   |
| `claimed`        | `claim(taskId, claims[])`             | File-claim array recorded (claim-registry rejects overlap in PR-23).                       |
| `dispatched`     | `dispatch(taskId, dispatchDetails?)`  | Task handed to the agent loop; Pi session creation is the caller's responsibility today.   |
| `agent_running`  | `markAgentRunning(taskId)`            | Agent loop in progress (called after `session.prompt()` issues).                           |
| `agent_complete` | `markAgentComplete(taskId, outcome)`  | Agent loop finished; outcome is `success` / `failed` / `blocked`.                          |
| `harvested`      | `harvest(taskId)`                     | `swt_report_result` envelope read; `TaskResult` persisted.                                 |
| `removed`        | `remove(taskId, {keepForForensics?})` | Terminal clean. `git worktree remove` ran (skipped if `keepForForensics: true`).           |
| `failed`         | `fail(taskId, reason)`                | Terminal failure. Reachable from any non-terminal state. Worktree is preserved by default. |

Illegal transitions throw `IllegalTransitionError`. The legal-transition rules are encoded in `worktree-manager.ts:isLegalTransition`.

## Journal entries

Each transition writes a JSON object on one line:

```json
{
  "timestamp": "2026-05-12T14:30:00.000Z",
  "taskId": "T-001",
  "from": "claimed",
  "to": "dispatched",
  "details": { "role": "dev", "tier": "balanced" }
}
```

Consumers (dashboard's Worktrees panel + the chaos test suite + `swt cleanup` from Plan 03-02 PR-29) tail this file. The `details` field is informational — unknown keys must not be load-bearing.

## `swt_report_result` extension wire-up (M3 PR-26)

Every session the orchestration-layer dispatcher creates carries `enableResultProtocol: true` + the `taskId` on its `SwtSessionOptions`. The runtime layer (today's mock) records these as no-ops; the deferred session-wiring follow-up consumes them to register `buildResultProtocolExtension()` on the real Pi session per [ADR-002](../decisions/ADR-002-extension-result-protocol.md).

The wire-up contract (locked at PR-26):

| Surface                                  | Today (PR-26)                            | Activated (session-wiring follow-up)                                                                          |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `SwtSessionOptions.enableResultProtocol` | Recorded by mock `createSession`; no-op. | Real Pi adapter threads `[buildResultProtocolExtension()]` into `createAgentSession({ customTools: [...] })`. |
| `SwtSessionOptions.taskId`               | Recorded; no-op.                         | Real Pi adapter writes a `task-context` custom session entry before the first `prompt()`.                     |
| Dispatcher → factory call                | Every dispatch passes both fields.       | Same — no change at the dispatcher layer.                                                                     |

Principle 1 stays intact: the orchestration layer's dispatcher passes a boolean + a string. It never imports `@earendil-works/*`. The Pi-side wiring lives entirely in `packages/runtime/src/session.ts` + `packages/runtime/src/extensions/result-protocol.ts`.

The cassette-gated integration test at `packages/orchestration/test/dispatcher.int.test.ts` documents the full ADR-002 round-trip:

1. Dispatcher creates a session with `enableResultProtocol: true`.
2. Real Pi loop fires `swt_report_result` with a `TaskResult`-shaped payload.
3. Closure-captured `pi.appendEntry` persists a `swt-task-result` custom entry.
4. `harvestTaskResult` reads + validates against `TaskResultSchema`.
5. `assertTaskIdMatch` confirms `task_id` round-trips.

This test activates the moment both gates land: the Anthropic cassette set + the session-wiring follow-up PR. No code change needed in the test itself.

## What's deferred (and to where)

| Deferred concern                             | Lands at                                              |
| -------------------------------------------- | ----------------------------------------------------- |
| Claim-conflict detection                     | M3 PR-23 (`claim-registry.ts`) ✓                      |
| `depends_on` → parallel batch resolution     | M3 PR-24 (`dag-resolver.ts`) ✓                        |
| PID-liveness lock files + crash recovery     | M3 PR-25 (`lock-files.ts`) ✓                          |
| `swt_report_result` Extension registration   | M3 PR-26 (`dispatcher.ts` hook) ✓                     |
| Per-worktree Pi session creation             | Session-wiring follow-up (PR-S — landed 2026-05-12) ✓ |
| `runMilestone` activation (real return path) | runMilestone follow-up (PR-T — landed 2026-05-12) ✓   |
| Dashboard Worktrees panel                    | M3 PR-27 (Plan 03-04)                                 |
| SIGKILL-at-every-transition chaos suite      | M3 PR-28 (Plan 03-04)                                 |
| `swt cleanup` verb (worktree retention)      | M3 PR-29 (Plan 03-04)                                 |
| Windows worktree path discipline (ADR-009)   | M3 PR-30 (Plan 03-04)                                 |

The `WorktreeManager.dispatch` method has an explicit `TODO(session-wiring follow-up)` comment marking the Pi session creation insertion point.

## Path discipline

All paths handled by `WorktreeManager` are POSIX-style (`/`-separated). The `child_process.spawn` boundary converts to Win32 only when needed per TDD2 §9.1.1. Cross-OS testing — including the path-length cap + line-ending handling — lands at Plan 03-02 PR-30 along with ADR-009 promotion.

## Operator workflow (future — once dispatcher integrates the manager)

```bash
# List active worktrees (Plan 03-02 PR-29 `swt cleanup` adds this verb;
# until then, inspect the journal directly):
ls -la .swt-planning/journal/

# Stream a worktree's transitions:
tail -F .swt-planning/journal/wt-T-001.jsonl

# Force-cleanup a stuck worktree (Plan 03-02 PR-29):
swt cleanup --force --task-id T-001
```

## See also

- **TDD2 §9.1** — worktree lifecycle FSM specification.
- **TDD2 §9.7** — keep-or-remove policy for terminal states.
- **TDD2 §13.3.1** — M3 PR table.
- **[ADR-008](../decisions/ADR-008-worktree-per-task.md)** — accepted at this PR.
- **[`packages/orchestration/src/worktree-manager.ts`](../../packages/orchestration/src/worktree-manager.ts)** — the implementation.
