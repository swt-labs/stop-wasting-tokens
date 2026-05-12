/**
 * Lock-file envelope per TDD2 §9.5.
 *
 * Each dispatched task acquires a lock at
 * `.swt-planning/locks/task-<taskId>.lock`. The envelope captures
 * everything needed for crash recovery without re-reading the
 * worktree journal:
 *
 *   - `pid`         — OS PID holding the lock. `process.kill(pid, 0)`
 *                     is the deterministic liveness signal.
 *   - `worktree_path` — pointer to `.swt-planning/parallel/wt-<taskId>/`
 *                     so recovery knows what to inspect / remove.
 *   - `session_id`  — Pi session ID once dispatched (optional pre-dispatch).
 *   - `state`       — last-recorded `WorktreeState`. Recovery uses this
 *                     to decide whether to resume or abort.
 *   - `started_at` / `updated_at` — for forensics + stale-lock detection
 *                     on systems where PID liveness alone is unreliable
 *                     (e.g., Docker container restarts that reuse PID 1).
 *
 * Frozen at `schema_version: 1`. Any field change requires a new
 * schema version + an ADR (lock files persist across crashes; old
 * lock files left on disk by a previous SWT version must still parse
 * cleanly).
 */

import { z } from 'zod';

import { WorktreeStateSchema } from './worktree-state.js';

export const LockFileEnvelopeSchema = z.object({
  /** Schema version pinned at 1 for the v3.0 release window. */
  schema_version: z.literal(1),
  /** Task ID this lock belongs to (matches `task-<id>.lock` basename). */
  task_id: z.string().min(1),
  /** OS PID holding the lock. Liveness probed via `process.kill(pid, 0)`. */
  pid: z.number().int().positive(),
  /** ISO 8601 timestamp of initial acquisition. */
  started_at: z.string().datetime({ offset: true }),
  /** Worktree path the lock guards (`.swt-planning/parallel/wt-<taskId>/`). */
  worktree_path: z.string().min(1),
  /** Pi session ID once the worktree-manager dispatches. */
  session_id: z.string().min(1).optional(),
  /** Last-recorded worktree FSM state for crash recovery. */
  state: WorktreeStateSchema,
  /** ISO 8601 timestamp of the most recent state update. */
  updated_at: z.string().datetime({ offset: true }).optional(),
});

export type LockFileEnvelope = z.infer<typeof LockFileEnvelopeSchema>;
