# Crash Recovery

REQ-11 — operator-facing reference for the cook crash-detection and
resume protocol shipped in Phase 6 plan 06-01.

## What gets recovered

**Per-commit granularity.** Every task that lands an atomic commit is
durably resumable; the last `cook.task_commit` event in the journal is
the high-water mark.

On the next `swt cook` invocation, the resume probe consults
`.swt-planning/.execution-state.json` and the cook events JSONL channel
(`.swt-planning/.events/cook-<sid>-<ts>.jsonl`) to detect a crashed
prior session, then rewinds the orchestrator's task pointer to either
the next task (when the last task committed cleanly but never reached
`task_complete`) or the in-flight task (when it crashed mid-execution
without a commit observation).

## What's lost

**Anything between the last commit and the kill.** Worst-case lost work
is bounded by the duration of the in-flight Pi turn — typically a few
minutes; up to ~3 minutes on slow turns. The CLAUDE.md "one commit per
task" discipline keeps this window short.

Pi 0.74 has no mid-turn pause / checkpoint primitive (see R2 below);
there is no resume granularity finer than per-task-commit today.

## Detection truth table (three-condition AND)

A crash is claimed only when ALL three conditions hold:

| Signal | Source | Meaning |
| --- | --- | --- |
| `status === 'in_progress'` | `.execution-state.json` | Prior cook recorded itself as still running |
| `PidChecker.isAlive(pid) === false` | `process.kill(pid, 0)` | The recorded pid is gone (ESRCH) |
| no `cook.completion` event for the recorded `session_id` | events JSONL tail | Prior cook never wrote its clean-exit row |

A single missing condition falls through to a fresh run — no recovery
is attempted. Specifically:

- Live recorded pid → **abort** the new invocation (refuse to race two
  cooks against the same execution-state). The operator's recourse is
  documented in "Manual override" below.
- `cook.completion` present in the journal → **fresh run**; the stale
  `in_progress` flag is flipped to `completed` (so the next probe
  doesn't re-fire on the same dead state).
- No events JSONL for the recorded `session_id` → **fresh run** (best
  effort — without the journal we have no high-water mark to resume to).

## Manual override

To force a fresh run despite a stale `.execution-state.json` (e.g. the
recorded pid was recycled to an unrelated process and the alive-detect
keeps firing), delete the state file:

```bash
rm .vbw-planning/.execution-state.json   # or .swt-planning/.execution-state.json
```

This is destructive — any pending-resume metadata is lost. A safer
`swt cook --no-resume` flag is on the Phase G roadmap; it is not in
scope for this phase.

## R2 limitation — mid-Pi-turn pause / checkpoint

Pi 0.74 has no mid-turn resume primitive (`cook-controls.ts:12-21`
documents this; the Phase 1 substrate audit confirmed there is no
PreToolUse intercept and no `systemPrompt` option). Resume granularity
is therefore per-task-commit, not mid-turn. A SIGKILL while Pi is
mid-execution forfeits up to ~one turn of work.

If Pi 0.75+ ships a mid-turn checkpoint primitive, Phase G will revisit
this contract and tighten the lost-work window.

## Where the journal lives

```
.swt-planning/.events/cook-<sessionId>-<startTs>.jsonl
```

Each line is a JSON-encoded `SnapshotEvent` (see
`packages/shared/src/schemas/events.ts`). The cook orchestrator appends
synchronously via `appendFileSync` at task boundaries; each line stays
under 500 bytes (PIPE_BUF-safe per POSIX) so the file-tail reader
cannot observe partial lines.

Three-AND condition signals (in journal order):

- `cook.task_start{plan, task_id, ts}` — emitted before each
  `spawnOrchestratorSession` call.
- `cook.task_commit{plan, task_id, commit_hash, ts}` — emitted after a
  successful spawn, recording the HEAD commit hash via `git log -1`.
- `cook.task_complete{plan, task_id, ts}` — emitted on a clean exit.
- `cook.task_fail{plan, task_id, reason, ts}` — emitted on any error
  path; `reason` is truncated at 200 chars.
- `cook.resume{from_task, last_commit_hash?, ts}` — emitted by the
  resume probe at recovery time; surfaces to the dashboard the
  high-water mark the next cook is restarting from.

## Dashboard surface

The existing dashboard events-tailer already consumes the
`.swt-planning/.events/cook-*.jsonl` glob. The new `cook.task_*` and
`cook.resume` variants flow through without configuration changes. A
dedicated `progress` SSE channel for a cleaner per-task progress view
is deferred polish for Phase G.

## Test coverage

The chaos regression test
`test/regression/crash-recovery.test.ts` covers three scenarios:

1. Crashed prior session — `status=in_progress`, dead pid, journal
   shows `T1` committed and `T2` started-but-not-committed. Probe
   returns `{kind:'resume', fromTask:'T2', lastCommitHash:'aaa111'}`.
   **The committed T1 is NOT replayed.**
2. Live concurrent cook — recorded pid alive (the test process's own
   pid). Probe returns `{kind:'abort_another_cook_running'}` and the
   journal is **not** mutated.
3. Clean prior session — journal contains `cook.completion`. Probe
   returns `{kind:'fresh_run', reason:'prior_completed'}` and the
   stale `in_progress` flag is flipped to `completed`.

Per-component unit coverage:

- `packages/methodology/test/state/execution-state.test.ts` —
  atomicity (temp+rename), schema, round-trip,
  `markCrashed`/`markCompleted` no-op behaviour.
- `packages/cli/test/commands/cook-resume.test.ts` — the full
  five-branch decision truth table.
