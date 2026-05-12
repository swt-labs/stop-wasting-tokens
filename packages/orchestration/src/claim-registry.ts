/**
 * `ClaimRegistry` — file-claim conflict prevention per TDD2 §9.2.
 *
 * Each dispatched task declares a `claims: ReadonlyArray<string>` array
 * in its `TaskBrief`. The registry rejects parallel tasks that would
 * touch the same claim path BEFORE any worktree is created or any LLM
 * tokens are spent.
 *
 * Identifiers are `SHA-1(normalized-lowercased-POSIX-path)` per TDD2
 * §13.3.3 — this makes the registry safe against case-insensitive
 * filesystems (macOS default, Windows NTFS). On Linux's case-sensitive
 * FS the lowercasing is over-conservative (it rejects `Foo.ts` +
 * `foo.ts` as conflicting even though Linux would allow both), but the
 * over-conservatism never lets a real conflict slip through.
 *
 * **M3 PR-23 ship state — registry + dispatcher wire-up.** Sequential
 * dispatch (today's dispatcher.ts default) doesn't really exercise the
 * registry: each task acquires + releases its claims back-to-back so
 * there's no window for conflict. The registry's value emerges with
 * the parallel dispatch path landing at PR-24 (`dag-resolver`). The
 * wire-up is here so the parallel path inherits conflict checking
 * automatically.
 */

import { createHash } from 'node:crypto';

export interface ClaimConflict {
  /** The path that conflicts (in its original form as supplied by the task). */
  readonly path: string;
  /** The task that already holds the conflicting claim. */
  readonly otherTaskId: string;
}

export type RegisterResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly conflicts: ReadonlyArray<ClaimConflict> };

interface ClaimEntry {
  readonly taskId: string;
  /** The original (non-normalized) path as supplied at registration time. */
  readonly originalPath: string;
}

/**
 * In-memory file-claim registry. One instance per dispatch run (or per
 * orchestrator lifecycle — the registry is cheap so a long-lived
 * singleton is fine).
 *
 * Methods:
 *   - `register(taskId, claims[])` — atomic registration of an array
 *     of claims. Either all succeed or none do; a `conflicts[]` array
 *     identifies overlap when `ok: false`.
 *   - `release(taskId)` — drop all claims held by the task. Safe to
 *     call for a taskId that holds nothing (no-op).
 *   - `pathBelongsToClaim(taskId, path)` — predicate used by the
 *     path-claim validator (Plan 03-02 + M4 territory).
 *   - `getClaimsForTask(taskId)` — return the original-form paths the
 *     task currently holds. Useful for journal/audit output.
 */
export class ClaimRegistry {
  private readonly byIdentifier = new Map<string, ClaimEntry>();
  private readonly byTask = new Map<string, Set<string>>();

  /**
   * Atomic claim registration. If any of the supplied paths conflict
   * with a different task's existing claims, NO claims are recorded
   * and the conflict list is returned. Self-overlap (the same task
   * re-registering paths it already holds) is treated as idempotent.
   */
  register(taskId: string, claims: ReadonlyArray<string>): RegisterResult {
    const conflicts: ClaimConflict[] = [];
    const toRegister: Array<{ readonly id: string; readonly originalPath: string }> = [];
    const seenInBatch = new Set<string>();

    for (const claim of claims) {
      const id = identifierFor(claim);
      if (seenInBatch.has(id)) {
        // Duplicate within the same registration call — silently
        // dedupe (the caller may have listed `Foo.ts` + `foo.ts` for
        // belt-and-braces; on a case-insensitive FS those are the
        // same file and we only need one record).
        continue;
      }
      seenInBatch.add(id);
      const existing = this.byIdentifier.get(id);
      if (existing === undefined) {
        toRegister.push({ id, originalPath: claim });
        continue;
      }
      if (existing.taskId === taskId) {
        // Idempotent self-registration; skip the redundant add.
        continue;
      }
      conflicts.push({ path: claim, otherTaskId: existing.taskId });
    }

    if (conflicts.length > 0) {
      return { ok: false, conflicts };
    }

    // No conflicts — commit all pending registrations.
    let taskClaims = this.byTask.get(taskId);
    if (taskClaims === undefined) {
      taskClaims = new Set<string>();
      this.byTask.set(taskId, taskClaims);
    }
    for (const { id, originalPath } of toRegister) {
      this.byIdentifier.set(id, { taskId, originalPath });
      taskClaims.add(id);
    }
    return { ok: true };
  }

  /**
   * Drop all claims held by the task. Idempotent — releasing a task
   * with no claims is a silent no-op.
   */
  release(taskId: string): void {
    const ids = this.byTask.get(taskId);
    if (ids === undefined) return;
    for (const id of ids) {
      const entry = this.byIdentifier.get(id);
      if (entry !== undefined && entry.taskId === taskId) {
        this.byIdentifier.delete(id);
      }
    }
    this.byTask.delete(taskId);
  }

  /**
   * Whether the given path is covered by one of the task's claims.
   * Uses the same SHA-1-of-normalized-lowercase-path identifier as
   * `register`. Returns false when the task holds no claims or holds
   * different claims.
   */
  pathBelongsToClaim(taskId: string, path: string): boolean {
    const id = identifierFor(path);
    const entry = this.byIdentifier.get(id);
    return entry !== undefined && entry.taskId === taskId;
  }

  /**
   * Return the original-form paths the task currently holds. Useful
   * for `swt cleanup` (Plan 03-02 PR-29) + dashboard inspection.
   * Order is insertion order.
   */
  getClaimsForTask(taskId: string): ReadonlyArray<string> {
    const ids = this.byTask.get(taskId);
    if (ids === undefined) return [];
    const paths: string[] = [];
    for (const id of ids) {
      const entry = this.byIdentifier.get(id);
      if (entry !== undefined) paths.push(entry.originalPath);
    }
    return paths;
  }

  /** Number of claims currently held (across all tasks). */
  size(): number {
    return this.byIdentifier.size;
  }

  /** Whether any task currently holds claims for the given path. */
  hasClaim(path: string): boolean {
    return this.byIdentifier.has(identifierFor(path));
  }
}

/**
 * Compute the SHA-1 identifier for a path. Normalization:
 *   1. Backslashes → forward slashes (Windows compatibility).
 *   2. Collapse multiple `/` → single `/`.
 *   3. Strip leading `./`.
 *   4. Lowercase (case-insensitive FS safety per TDD2 §13.3.3).
 *
 * Note: this is exported for unit tests; production callers should use
 * the registry's methods directly.
 */
export function identifierFor(path: string): string {
  const normalized = normalizePath(path);
  return createHash('sha1').update(normalized, 'utf8').digest('hex');
}

function normalizePath(path: string): string {
  let s = path.replace(/\\/g, '/');
  s = s.replace(/\/+/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  s = s.toLowerCase();
  return s;
}
