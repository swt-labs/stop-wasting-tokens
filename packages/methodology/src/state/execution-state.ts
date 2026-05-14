/**
 * Plan 06-01 (Phase 6) T1 — Event-sourced execution-state module.
 *
 * REQ-11 crash-recovery substrate:
 *
 *   - Zod-validated schema for `.vbw-planning/.execution-state.json` (or
 *     `.swt-planning/.execution-state.json` in the v3 production tree).
 *   - `atomicWriteJSON` helper (temp+rename) for crash-safe state writes.
 *     `fs.writeFileSync` is rename-on-write atomic on POSIX but a SIGKILL
 *     between truncate and write leaves a 0-byte file; temp+rename closes
 *     that window. Exported so `meters/token-meter.ts` can wrap its
 *     `.metrics/{session,phase}-*.json` writes through the same helper
 *     (research §1.5 atomicity gate).
 *   - `markCrashed` / `markCompleted` lifecycle helpers used by
 *     `cli/src/commands/cook.ts` runMode try/finally outer wrap.
 *
 * Architect decisions (research §7 → plan 06-01):
 *
 *   - R2 ACCEPT: per-task-commit granularity. Pi 0.74 has no mid-turn
 *     checkpoint primitive, so a SIGKILL mid-Pi-turn forfeits ≤turn-duration
 *     of work. Documented in `docs/operations/crash-recovery.md`.
 *   - Atomicity: temp+rename for `.execution-state.json` AND
 *     `.metrics/*.json`. Shared helper here; two callsites converted
 *     (the new state writer + the pre-existing `token-meter.ts:133`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Zod schema
// ────────────────────────────────────────────────────────────────────────────

const PlanStatusSchema = z.enum(['planning', 'in_progress', 'paused', 'completed', 'crashed']);

const PlanEntrySchema = z.object({
  plan: z.string().min(1),
  status: PlanStatusSchema,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  last_commit_hash: z.string().optional(),
});

export const ExecutionStateSchema = z.object({
  phase: z.number().int().nonnegative(),
  phase_name: z.string().min(1),
  status: PlanStatusSchema,
  wave: z.number().int().nonnegative(),
  total_waves: z.number().int().nonnegative(),
  plans: z.array(PlanEntrySchema),
  correlation_id: z.string().min(1),
  session_id: z.string().optional(),
  pid: z.number().int().positive().optional(),
  started_at: z.string().optional(),
  last_event_ts: z.string().optional(),
});

export type PlanEntry = z.infer<typeof PlanEntrySchema>;
export type ExecutionStateStatus = z.infer<typeof PlanStatusSchema>;
export type ExecutionStateRecord = z.infer<typeof ExecutionStateSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Path resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the `.execution-state.json` path inside the planning root.
 * The caller passes the project root; we look for `.vbw-planning/` first
 * (this repo's plugin co-existence layout per CLAUDE.md) and fall back
 * to `.swt-planning/` (v3 production tree).
 */
export function executionStatePath(rootDir: string): string {
  const vbw = path.join(rootDir, '.vbw-planning');
  if (fs.existsSync(vbw)) {
    return path.join(vbw, '.execution-state.json');
  }
  return path.join(rootDir, '.swt-planning', '.execution-state.json');
}

// ────────────────────────────────────────────────────────────────────────────
// Atomic write helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Atomic JSON write — `<path>.tmp` → `fs.renameSync(tmp, path)`. Crash
 * between the truncate-and-write of the underlying file is impossible
 * because the target is only swapped in once the temp file is fully on
 * disk. On any error the temp file is best-effort cleaned up so we don't
 * leak `.tmp` orphans.
 *
 * Used by `writeExecutionState` AND `meters/token-meter.ts` for session /
 * phase metrics — both files must survive a SIGKILL between turns.
 */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file so we don't leak `.tmp`
    // orphans on disk. Swallow the unlink error — the original write
    // error is what callers care about.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Read / write API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read `.execution-state.json`. Returns null if the file does not exist
 * (fresh project). Throws if the file is present but fails schema
 * validation — loud-fail is preferable to silent corruption when the
 * resume probe is about to make scheduling decisions off this state.
 */
export function readExecutionState(rootDir: string): ExecutionStateRecord | null {
  const file = executionStatePath(rootDir);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const result = ExecutionStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `readExecutionState: ${file} failed schema validation: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * Write `.execution-state.json` atomically. Caller is responsible for
 * producing a schema-valid object; we validate before writing so a bad
 * state never reaches disk.
 */
export function writeExecutionState(rootDir: string, state: ExecutionStateRecord): void {
  ExecutionStateSchema.parse(state);
  atomicWriteJSON(executionStatePath(rootDir), state);
}

/**
 * Flip status to `'crashed'` in-place. No-op if the file is missing —
 * the next cookHandler invocation will start fresh.
 */
export function markCrashed(rootDir: string): void {
  const state = readExecutionState(rootDir);
  if (state === null) return;
  const next: ExecutionStateRecord = {
    ...state,
    status: 'crashed',
    last_event_ts: new Date().toISOString(),
  };
  writeExecutionState(rootDir, next);
}

/**
 * Flip status to `'completed'` in-place. No-op if the file is missing.
 */
export function markCompleted(rootDir: string): void {
  const state = readExecutionState(rootDir);
  if (state === null) return;
  const next: ExecutionStateRecord = {
    ...state,
    status: 'completed',
    last_event_ts: new Date().toISOString(),
  };
  writeExecutionState(rootDir, next);
}
