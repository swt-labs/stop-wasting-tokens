/**
 * Plan 03-01 T3 — pure helpers + atomic snapshot writer for the
 * `swt list-todos` verb.
 *
 * Three exports:
 *   - `filterTodos(entries, filter)` — pure AND-combinator; empty/null
 *     filter is a no-op pass-through; unknown filter keys match nothing
 *     (forward-compat per research §Risks "Filter key validation").
 *   - `renderTodoList(entries)` — pure renderer; numbered, 1-indexed,
 *     status-iconified; returns `(no todos)\n` for the empty case (MH-05).
 *   - `writeListTodosSnapshot(planningRoot, snapshot)` — the ONLY
 *     side-effecting export; validates via Zod BEFORE writing; mirrors
 *     Phase 02's `writeTodoDetail` atomic-write pattern (temp file in
 *     the same dir as the target + `fs.rename`, POSIX-atomic).
 *
 * Status icons follow VBW + SWT brand convention:
 *   `[TODO]` → ○, `[IN-PROGRESS]` → ◆, `[BLOCKED]` → ✗, `[DONE]` → ✓.
 * Unknown tags fall back to ○ (MH-07).
 *
 * L0-L7 layer rule: imports `@swt-labs/shared` (L0), `node:fs/promises`,
 * `node:path` only.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ListTodosSnapshotSchema,
  type ListTodosSnapshot,
  type TodoEntry,
} from '@swt-labs/shared';

/** Bracketed status tag → display icon. Unknown tags fall back to ○. */
export const STATUS_ICONS = {
  '[TODO]': '○',
  '[IN-PROGRESS]': '◆',
  '[BLOCKED]': '✗',
  '[DONE]': '✓',
} as const;

const FALLBACK_STATUS_ICON = '○';

/**
 * Relative path (from `planningRoot`) at which `writeListTodosSnapshot`
 * persists the session snapshot. Phase 04's bare-integer cook resolver
 * reads from the same location.
 */
export const SNAPSHOT_RELATIVE_PATH = '.cache/list-todos-snapshot.json';

/** A `--filter key=value`-derived AND-filter. Empty/null means no-op. */
export type ListTodosFilter = Readonly<Record<string, string>>;

/**
 * Pure AND-combinator. Empty/null filter is a no-op pass-through.
 *
 * For non-empty filters, every entry must have a string-equal value for
 * every key in the filter. Unknown keys (i.e. keys not present on the
 * `TodoEntry` shape) match nothing — every entry will be excluded.
 * This is forward-compatible: adding a new annotation later does not
 * break old `list-todos` binaries.
 */
export function filterTodos(
  entries: readonly TodoEntry[],
  filter: ListTodosFilter | null,
): readonly TodoEntry[] {
  if (filter === null) return entries;
  const filterEntries = Object.entries(filter);
  if (filterEntries.length === 0) return entries;
  return entries.filter((entry) => {
    const record = entry as unknown as Record<string, unknown>;
    return filterEntries.every(([key, value]) => record[key] === value);
  });
}

/**
 * Render a numbered list of todos for human-readable stdout output.
 *
 * Format mirrors AC-01:
 *   ` 1. ○ fix the login bug (phase:02) (priority:high) (ref:abc12345)`
 *
 * 1-indexed; index column is left-padded so two-digit indexes stay
 * aligned. Status icon comes from `STATUS_ICONS` (fallback ○ for
 * unknown tags — MH-07). Annotations are appended in the SAME stable
 * order Phase 02 wrote them: phase → priority → assignee. `ref` is
 * always appended last.
 *
 * Empty input returns the literal string `(no todos)\n` (MH-05).
 */
export function renderTodoList(entries: readonly TodoEntry[]): string {
  if (entries.length === 0) return '(no todos)\n';
  const width = String(entries.length).length;
  return (
    entries
      .map((entry, idx) => {
        const number = String(idx + 1).padStart(width, ' ');
        const icon =
          STATUS_ICONS[entry.status as keyof typeof STATUS_ICONS] ?? FALLBACK_STATUS_ICON;
        let line = ` ${number}. ${icon} ${entry.description}`;
        if (entry.phase !== undefined) line += ` (phase:${entry.phase})`;
        if (entry.priority !== undefined) line += ` (priority:${entry.priority})`;
        if (entry.assignee !== undefined) line += ` (assignee:${entry.assignee})`;
        line += ` (ref:${entry.ref})`;
        return line;
      })
      .join('\n') + '\n'
  );
}

/**
 * Atomically write the session snapshot to
 * `<planningRoot>/.cache/list-todos-snapshot.json`.
 *
 * Mirrors `writeTodoDetail` in `packages/cli/src/lib/todo-state.ts:285-291`:
 *   1. `mkdir -p` the parent dir (creates `.cache/` on first write).
 *   2. Validate the snapshot via `ListTodosSnapshotSchema.parse(...)` —
 *      bad input throws BEFORE any file is touched (AC-07).
 *   3. Write the JSON to a temp file in the SAME dir as the target
 *      (POSIX rename atomicity requires same filesystem; same dir is
 *      the safe guarantee).
 *   4. `fs.rename` the temp file to the final path.
 */
export async function writeListTodosSnapshot(
  planningRoot: string,
  snapshot: ListTodosSnapshot,
): Promise<void> {
  const path = join(planningRoot, SNAPSHOT_RELATIVE_PATH);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  // Validate BEFORE writing — bad input throws here, no file mutated.
  ListTodosSnapshotSchema.parse(snapshot);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}
