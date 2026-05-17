/**
 * Plan 15-04-01 T1 — read-side helpers consumed by the `swt cook`
 * bare-integer pickup resolver and the `--todo N` escape hatch.
 *
 * Two exports:
 *   - `readSnapshotForPickup(cwd, opts, logger?)` — loads
 *     `.swt-planning/.cache/list-todos-snapshot.json` (Phase 03 canonical
 *     path via `SNAPSHOT_RELATIVE_PATH`), parses + Zod-validates, and
 *     applies caller-controlled TTL + filter guards. Returns the snapshot
 *     when usable; returns `null` on any non-fatal condition (ENOENT,
 *     malformed JSON, Zod failure, stale under `requireFresh`, filtered
 *     under `requireUnfiltered`). For the soft fall-through cases — stale
 *     OR filtered while the corresponding guard is on — the optional
 *     `logger` is invoked exactly once with a human-readable explanation.
 *
 *   - `loadTodoDetailForRef(cwd, hash)` — wraps Phase 02's
 *     `readTodoDetails(planningRoot)` and returns the single
 *     `TodoDetailsFile.todos[hash]` entry (or `undefined` when absent).
 *     `readTodoDetails` already handles ENOENT (returns empty default);
 *     a Zod-validation failure on a malformed `todo-details.json` will
 *     PROPAGATE — the caller's responsibility is to swallow + log per
 *     plan T4 / research §Risks "todo-details.json missing the hash".
 *
 * Return-shape choice: the simpler `ListTodosSnapshot | null` is used —
 * both callers (bare-integer resolver and `--todo` branch) map the null
 * case identically and consume the snapshot object directly. The earlier
 * draft's `{snapshot, fallthroughReason?}` envelope added no value at the
 * call site and is therefore omitted (plan T1 action note explicitly
 * permits this simplification).
 *
 * L0-L7 layer rule: imports from `@swt-labs/shared` (L0), `node:fs/promises`,
 * `node:path`, and sibling L6 modules (`./list-todos-render.js`,
 * `./todo-state.js`) — no upward imports.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  LIST_TODOS_SNAPSHOT_TTL_MS,
  ListTodosSnapshotSchema,
  type ListTodosSnapshot,
  type TodoDetail,
} from '@swt-labs/shared';

import { SNAPSHOT_RELATIVE_PATH } from './list-todos-render.js';
import { readTodoDetails } from './todo-state.js';

/**
 * Caller-controlled guards. Bare-integer pickup passes both `true` (the
 * implicit-intent path must be conservative). `--todo N` passes both
 * `false` (explicit-intent escape hatch — only fails on missing snapshot
 * or out-of-range).
 */
export interface ReadSnapshotOptions {
  readonly requireFresh: boolean;
  readonly requireUnfiltered: boolean;
}

/**
 * Load + validate the session snapshot. Returns `null` for every
 * non-fatal condition; the optional `logger` is invoked exactly once for
 * the stale and filtered soft fall-throughs (the cookHandler wires this
 * to `io.stderr.write` with a `[cook] ` prefix).
 */
export async function readSnapshotForPickup(
  cwd: string,
  opts: ReadSnapshotOptions,
  logger?: (msg: string) => void,
): Promise<ListTodosSnapshot | null> {
  const snapshotPath = join(cwd, '.swt-planning', SNAPSHOT_RELATIVE_PATH);

  let raw: string;
  try {
    raw = await readFile(snapshotPath, 'utf8');
  } catch {
    // ENOENT or any other read error → silent fall-through (the user
    // may simply have never run `swt list-todos`).
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    // Malformed JSON — silent fall-through (a prior `swt list-todos`
    // may have been interrupted mid-write).
    return null;
  }

  const result = ListTodosSnapshotSchema.safeParse(parsedJson);
  if (!result.success) {
    // Zod rejection — silent fall-through (schema drift / hand-edit).
    return null;
  }
  const snapshot = result.data;

  if (opts.requireFresh) {
    const generatedAtMs = Date.parse(snapshot.generated_at);
    if (Number.isFinite(generatedAtMs)) {
      const ageMs = Date.now() - generatedAtMs;
      if (ageMs > LIST_TODOS_SNAPSHOT_TTL_MS) {
        const ageMin = Math.round(ageMs / 60_000);
        logger?.(
          `snapshot stale (generated ${ageMin}m ago) — falling through to phase-number resolution`,
        );
        return null;
      }
    }
  }

  if (opts.requireUnfiltered && snapshot.filter !== null) {
    const filterStr = Object.entries(snapshot.filter)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    logger?.(
      `snapshot is filtered (${filterStr}) — falling through to phase-number resolution`,
    );
    return null;
  }

  return snapshot;
}

/**
 * Resolve `details.todos[hash]` from `.swt-planning/todo-details.json`.
 * Returns `undefined` when the file does not exist (Phase 02's
 * `readTodoDetails` already substitutes the empty default), the hash is
 * absent, or the file's `todos` record never had that key. A
 * Zod-validation failure on a malformed file PROPAGATES — callers
 * swallow + log per plan T4 / research §Risks.
 */
export async function loadTodoDetailForRef(
  cwd: string,
  hash: string,
): Promise<TodoDetail | undefined> {
  const planningRoot = join(cwd, '.swt-planning');
  const details = await readTodoDetails(planningRoot);
  return details.todos[hash];
}
