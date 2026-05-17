/**
 * Plan 03-01 T2 — STATE.md `## Todos` line parser for the `swt list-todos`
 * verb.
 *
 * Separation of concerns vs Phase 02's `todo-state.ts`: that module is
 * write-focused (append + idempotency + sidecar round-trip). This module
 * is read-only — `parseTodosFromState(statePath)` turns the section body
 * into structured `TodoEntry[]` objects in source order.
 *
 * Returns `[]` (NOT throws) in three soft cases:
 *   - STATE.md does not exist (ENOENT),
 *   - `## Todos` section is absent,
 *   - the section exists but contains no `- [TAG] ...` entry lines.
 *
 * Each parsed entry is validated through `TodoEntrySchema.parse(...)` so
 * a malformed file surfaces as a Zod error early rather than as a
 * downstream runtime crash. Lines that DO NOT match the regex are
 * skipped silently — forward-compat for a future status-change verb
 * that might add comment lines or table rows.
 *
 * L0-L7 layer rule: this file imports from `@swt-labs/shared` (L0) and
 * `node:fs/promises` only. No upward imports.
 */

import { readFile } from 'node:fs/promises';

import { TodoEntrySchema, type TodoEntry } from '@swt-labs/shared';

/**
 * Canonical regex for a STATE.md `## Todos` entry line. The first
 * capture group is the bracketed status tag (matches all four —
 * `[TODO]` / `[IN-PROGRESS]` / `[BLOCKED]` / `[DONE]`); the second is
 * the description; the third is the `added` date; the fourth is the
 * 8-char ref (optionally suffixed with `-N` for the collision case);
 * the fifth (greedy) captures the optional annotation tail which is
 * then parsed by the secondary regexes below.
 *
 * Exported so the test suite can assert against the same source of truth.
 */
export const STATE_TODOS_LINE_REGEX =
  /^- (\[TODO\]|\[IN-PROGRESS\]|\[BLOCKED\]|\[DONE\]) (.+?) \(added (\d{4}-\d{2}-\d{2})\) \(ref:([0-9a-f]{8}(?:-[0-9]+)?)\)(.*)$/;

const ANNOTATION_PHASE_REGEX = /\(phase:(\d{2})\)/;
const ANNOTATION_PRIORITY_REGEX = /\(priority:(high|medium|low)\)/;
const ANNOTATION_ASSIGNEE_REGEX = /\(assignee:([^)]+)\)/;

/**
 * Parse `STATE.md ## Todos` lines into structured `TodoEntry[]` objects
 * in source order.
 *
 * Returns `[]` when STATE.md does not exist, when the `## Todos`
 * section is absent, or when the section exists but contains no
 * matching entry lines.
 *
 * Each parsed entry is validated against `TodoEntrySchema` — a
 * malformed file (e.g. invalid priority value) throws a Zod error.
 * Lines that do not match the canonical line regex are skipped silently
 * (forward-compat).
 */
export async function parseTodosFromState(statePath: string): Promise<TodoEntry[]> {
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const section = extractTodosSectionBody(raw);
  if (section === null) return [];

  const out: TodoEntry[] = [];
  for (const line of section.split('\n')) {
    if (line === '') continue;
    const match = STATE_TODOS_LINE_REGEX.exec(line);
    if (match === null) continue;
    const [, statusRaw, description, addedDate, ref, tail] = match;
    if (
      statusRaw === undefined ||
      description === undefined ||
      addedDate === undefined ||
      ref === undefined
    ) {
      continue;
    }
    const annotationTail = tail ?? '';
    const phaseMatch = ANNOTATION_PHASE_REGEX.exec(annotationTail);
    const priorityMatch = ANNOTATION_PRIORITY_REGEX.exec(annotationTail);
    const assigneeMatch = ANNOTATION_ASSIGNEE_REGEX.exec(annotationTail);

    const entry: Record<string, unknown> = {
      status: statusRaw,
      description,
      added_date: addedDate,
      ref,
    };
    if (phaseMatch?.[1] !== undefined) entry['phase'] = phaseMatch[1];
    if (priorityMatch?.[1] !== undefined) entry['priority'] = priorityMatch[1];
    if (assigneeMatch?.[1] !== undefined) entry['assignee'] = assigneeMatch[1];

    out.push(TodoEntrySchema.parse(entry));
  }
  return out;
}

/**
 * Locate the body of the `## Todos` section. Returns `null` when the
 * heading is absent. Returns an empty string when the heading exists
 * but no body lines follow (or only blank lines do).
 *
 * Same heading-match-plus-next-`^## `-or-EOF logic as Phase 02's
 * `extractTodosSection` in `todo-state.ts:197-210`. Inlined here rather
 * than refactored out so this plan does not modify the Phase 02 file
 * (parallel-safety + minimal diff surface).
 */
function extractTodosSectionBody(raw: string): string | null {
  if (raw === '') return null;
  const lines = raw.split('\n');
  const headingIndex = lines.findIndex((line) => line === '## Todos');
  if (headingIndex === -1) return null;
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i] !== undefined && lines[i]!.startsWith('## ')) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(headingIndex + 1, endIndex).join('\n');
}
