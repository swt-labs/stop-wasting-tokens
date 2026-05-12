# `swt cleanup`

Operator-facing worktree retention + lock-file forensics per TDD2 §9.7 + ADR-008.

> **Status (M3 PR-29, 2026-05-12):** ships. Three modes are operational: read-only `--list`, force-cleanup `--force --task-id <id>`, and stale-lock pruning `--prune-locks`. No further code change required.

## Synopsis

```bash
swt cleanup [--list]
swt cleanup --force --task-id <id>
swt cleanup --prune-locks
```

The default invocation (`swt cleanup`) maps to `--list`.

| Flag             | Purpose                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--list`         | Print every active worktree's task ID, last journal state, journal mtime, and lock-file PID + liveness. Read-only.    |
| `--force`        | Force-cleanup mode. Requires `--task-id`. Runs `git worktree remove --force`, deletes the journal, releases the lock. |
| `--task-id <id>` | Task ID to force-cleanup (paired with `--force`).                                                                     |
| `--prune-locks`  | Delete every lock file whose PID is dead OR whose envelope is corrupt. Surfaces the absolute paths of locks removed.  |

## What it does

`swt cleanup` is the operator's escape hatch for the M3 worktree FSM (TDD2 §9.1). When `WorktreeManager` crashes mid-transition or a parallel-dispatch run is interrupted, the on-disk state (parallel directory + journal + lock file) can drift from the manager's recovered view. `swt cleanup` lets the operator:

1. **Inspect** that drift (`--list`).
2. **Resolve it cleanly** without manually invoking `git worktree remove` + `rm` (`--force --task-id`).
3. **Reclaim slots** held by dead-PID lock files left over from crashed sessions (`--prune-locks`).

Per TDD2 §9.7's keep-or-remove policy, this verb is the only sanctioned way to remove a worktree outside the FSM's normal `remove` transition. `--force` writes nothing to the journal — the operator is acknowledging that the worktree's state is no longer load-bearing.

## Sample `--list` output

```text
$ swt cleanup
Active worktrees:
  T-001                state=claimed          mtime=2026-05-12T10:00:00.000Z  lock pid=12345 (alive)
  T-002                state=harvested        mtime=2026-05-12T10:05:00.000Z  no lock
  T-003                state=(no journal)     mtime=—                          lock pid=99999 (dead)
```

Notes:

- "no lock" = the worktree's lock was released (typically after `harvested`).
- "(no journal)" rows surface orphan locks — a lock file with no corresponding journal. Usually a forensic signal that `acquireLock` ran but the FSM never wrote a `created` transition. Treat as a `--prune-locks` candidate.
- The liveness column is computed at invocation time via `process.kill(pid, 0)`.

## `--force` semantics

`swt cleanup --force --task-id T-001` does, in order:

1. If `.swt-planning/parallel/wt-T-001/` exists, run `git worktree remove --force <path>` from the project root. On non-zero exit, the error is written to stderr but cleanup continues — the journal + lock cleanup is still useful even if `git worktree remove` failed (corrupt repo state, manual `rm -rf` already happened, etc.).
2. Delete `.swt-planning/journal/wt-T-001.jsonl` (idempotent — missing file is success).
3. Delete `.swt-planning/locks/task-T-001.lock` (idempotent — missing file is success).
4. Print `Removed worktree, journal, and lock for T-001.`

`--force` is destructive. No confirmation prompt. Operator is expected to have run `swt cleanup --list` first.

## `--prune-locks` semantics

Delegates to `purgeStaleLocks({purgeCorrupt: true})` from `@swt-labs/orchestration`. A lock is purged when either:

- Its PID is dead (`process.kill(pid, 0)` throws ESRCH), OR
- Its envelope fails `LockFileEnvelopeSchema` parse (corrupt lock).

Live locks are preserved untouched. Use `--force` when you need to release a specific lock whose PID is still alive.

## Exit codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 0    | Operation completed (zero is success in every mode).                   |
| 1    | `EXIT.USAGE_ERROR` — `--force` passed without `--task-id`.             |
| 2    | `EXIT.NOT_IMPLEMENTED` — no `.swt-planning/` in the current directory. |
| 3    | `EXIT.RUNTIME_ERROR` — unexpected error from git or fs operations.     |

## Principle 1 invariant

Per [TDD2 §4.3](../../../TDD2.md): `swt cleanup`'s handler imports from `@swt-labs/orchestration` (the layer that owns `readLocks` + `purgeStaleLocks` + `LOCK_FILE_PREFIX/SUFFIX`). It NEVER imports `@earendil-works/*`. The `git worktree remove` invocation goes through `node:child_process.spawn`, not Pi.

## See also

- **TDD2 §9.7** — keep-or-remove policy for terminal worktree states.
- **TDD2 §9.5** — lock-file envelope + PID-liveness rules.
- **[ADR-008](../../decisions/ADR-008-worktree-per-task.md)** — accepted at M3 PR-22.
- **[`docs/operations/worktree-dispatcher.md`](../../operations/worktree-dispatcher.md)** — the lifecycle FSM reference.
- **[`packages/cli/src/commands/cleanup.ts`](../../../packages/cli/src/commands/cleanup.ts)** — the CLI handler.
