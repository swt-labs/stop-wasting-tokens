/**
 * Plan 15-02-01 T2 — STATE.md `## Todos` parser/appender + sidecar
 * `.swt-planning/todo-details.json` helpers for the `swt todo` verb.
 *
 * Design notes:
 *  - **Line-by-line parser, NOT roundtrip.** Section detection uses an
 *    exact-line `## Todos` match. The section ends at the next `^## `
 *    line or EOF. Every byte outside the located section is preserved
 *    verbatim — the existing `[KNOWN-ISSUE]` rows live inside `## Todos`
 *    and are left untouched.
 *  - **Atomic writes.** Both STATE.md and todo-details.json are written
 *    via `{path}.tmp` + `rename(...)` so a crash mid-write never leaves
 *    a half-baked file. Parent dirs are created on demand.
 *  - **Idempotency.** `appendTodoToState` scans the existing section
 *    body for a literal `(ref:HASH)` substring; if present, the call
 *    returns `{appended: false}` and the file is not rewritten.
 *  - **No `node:crypto` import in shared (L0).** The hash helper lives
 *    here at L6 (CLI) so the shared package keeps its zero-dep posture.
 *
 * Public surface: `computeTodoHash`, `todoExistsInState`,
 * `appendTodoToState`, `readTodoDetails`, `writeTodoDetail`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  type TodoDetail,
  type TodoDetailsFile,
  TodoDetailsFileSchema,
  type TodoPriority,
} from '@swt-labs/shared';

/**
 * sha256(description).slice(0, 8). Deterministic by construction —
 * the same description always produces the same 8-char hex digest.
 */
export function computeTodoHash(description: string): string {
  return createHash('sha256').update(description).digest('hex').slice(0, 8);
}

/**
 * Return true if `STATE.md ## Todos` already contains a literal
 * `(ref:HASH)` substring. Reads the file once; returns false if the
 * file does not exist.
 */
export async function todoExistsInState(statePath: string, hash: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  const section = extractTodosSection(raw);
  if (section === null) return false;
  return section.body.includes(`(ref:${hash})`);
}

/**
 * Arguments accepted by `appendTodoToState`. The `addedDate` field is
 * optional and defaults to today's date in `YYYY-MM-DD` (UTC).
 */
export interface AppendTodoArgs {
  readonly statePath: string;
  readonly description: string;
  readonly hash: string;
  readonly phase?: string;
  readonly priority?: TodoPriority;
  readonly assignee?: string;
  readonly addedDate?: string;
}

export interface AppendTodoResult {
  readonly appended: boolean;
  /** The exact line written (or that already existed, when appended === false). */
  readonly line: string;
}

/**
 * Append a `- [TODO] ...` entry to STATE.md `## Todos`. Preserves every
 * other section byte-equal. Creates `## Todos` if absent (inserts after
 * `## Activity Log` when present, otherwise appended at EOF with a
 * leading blank line). Idempotent: a hash already present in the
 * section yields `{appended: false, line: <existing>}`.
 */
export async function appendTodoToState(args: AppendTodoArgs): Promise<AppendTodoResult> {
  const today = args.addedDate ?? new Date().toISOString().slice(0, 10);
  const line = formatTodoLine({
    description: args.description,
    hash: args.hash,
    addedDate: today,
    phase: args.phase,
    priority: args.priority,
    assignee: args.assignee,
  });

  let raw: string;
  try {
    raw = await readFile(args.statePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      raw = '';
    } else {
      throw err;
    }
  }

  const section = extractTodosSection(raw);
  if (section !== null) {
    // Section exists — check for the hash anywhere in its body first.
    const existing = findExistingLineByHash(section.body, args.hash);
    if (existing !== null) {
      return { appended: false, line: existing };
    }
    // Append the new line at the end of the section's content lines
    // (preserves any trailing blank line that separated the section
    // from the next heading).
    const nextRaw = insertLineAtSectionEnd(raw, section, line);
    await atomicWriteFile(args.statePath, nextRaw);
    return { appended: true, line };
  }

  // No `## Todos` section — create it. If `## Activity Log` exists,
  // insert immediately AFTER its block; otherwise append at EOF with
  // a leading blank line.
  const next = createTodosSection(raw, line);
  await atomicWriteFile(args.statePath, next);
  return { appended: true, line };
}

/**
 * Read `.swt-planning/todo-details.json`, parse it through Zod, return
 * the typed record. Returns the empty default `{ schema_version: 1,
 * todos: {} }` if the file does not exist.
 */
export async function readTodoDetails(planningRoot: string): Promise<TodoDetailsFile> {
  const path = join(planningRoot, 'todo-details.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schema_version: 1, todos: {} };
    }
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return TodoDetailsFileSchema.parse(parsed);
}

/**
 * Write a single `TodoDetail` entry to `.swt-planning/todo-details.json`
 * under the given hash key. Preserves all other entries. Validates the
 * resulting file via Zod BEFORE writing. Uses temp + rename for
 * atomicity; creates the parent dir on demand.
 */
export async function writeTodoDetail(
  planningRoot: string,
  hash: string,
  detail: TodoDetail,
): Promise<void> {
  const existing = await readTodoDetails(planningRoot);
  const next: TodoDetailsFile = {
    schema_version: 1,
    todos: { ...existing.todos, [hash]: detail },
  };
  // Validates BEFORE writing — bad input throws here, no file mutated.
  TodoDetailsFileSchema.parse(next);
  const path = join(planningRoot, 'todo-details.json');
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

/* ───────────────────────────── internals ───────────────────────────── */

interface TodosSection {
  /** Index of the line that holds `## Todos`. */
  readonly headingIndex: number;
  /** Index of the FIRST line that no longer belongs to the section. */
  readonly endIndex: number;
  /** The body text (excluding the heading line itself). */
  readonly body: string;
  /** The file split into lines with newline semantics preserved. */
  readonly lines: readonly string[];
}

/** Split a string into lines but keep the original line endings intact. */
function splitLinesPreserving(raw: string): string[] {
  if (raw === '') return [];
  // Split on \n but keep \r on the lines (Windows is rare in this repo;
  // we just don't mangle it if it shows up). The trailing empty element
  // after a final '\n' is preserved as '' so a join with '\n' round-trips.
  return raw.split('\n');
}

function extractTodosSection(raw: string): TodosSection | null {
  const lines = splitLinesPreserving(raw);
  const headingIndex = lines.findIndex((line) => line === '## Todos');
  if (headingIndex === -1) return null;
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i] !== undefined && lines[i]!.startsWith('## ')) {
      endIndex = i;
      break;
    }
  }
  const body = lines.slice(headingIndex + 1, endIndex).join('\n');
  return { headingIndex, endIndex, body, lines };
}

function findExistingLineByHash(body: string, hash: string): string | null {
  const needle = `(ref:${hash})`;
  for (const line of body.split('\n')) {
    if (line.includes(needle)) return line;
  }
  return null;
}

function insertLineAtSectionEnd(
  _raw: string,
  section: TodosSection,
  newLine: string,
): string {
  const { lines, headingIndex, endIndex } = section;
  // Trim trailing blank lines from the section's content range — we
  // want to append BEFORE them so the file shape stays the same.
  let lastContentIndex = endIndex - 1;
  while (lastContentIndex > headingIndex && lines[lastContentIndex] === '') {
    lastContentIndex -= 1;
  }
  const before = lines.slice(0, lastContentIndex + 1);
  const after = lines.slice(lastContentIndex + 1);
  return [...before, newLine, ...after].join('\n');
}

function createTodosSection(raw: string, newLine: string): string {
  if (raw === '') {
    return `## Todos\n${newLine}\n`;
  }
  const lines = splitLinesPreserving(raw);
  // Look for `## Activity Log` and locate the end of its block.
  const alIndex = lines.findIndex((line) => line === '## Activity Log');
  if (alIndex !== -1) {
    let alEnd = lines.length;
    for (let i = alIndex + 1; i < lines.length; i++) {
      if (lines[i] !== undefined && lines[i]!.startsWith('## ')) {
        alEnd = i;
        break;
      }
    }
    // Trim trailing blank lines inside the AL block so the inserted
    // section sits right after the last AL content line, separated by
    // a single blank line.
    let lastALContent = alEnd - 1;
    while (lastALContent > alIndex && lines[lastALContent] === '') {
      lastALContent -= 1;
    }
    const before = lines.slice(0, lastALContent + 1);
    const after = lines.slice(lastALContent + 1);
    return [...before, '', '## Todos', newLine, ...after].join('\n');
  }
  // No Activity Log — append at EOF with a leading blank line.
  const trimmed = raw.replace(/\n+$/, '');
  return `${trimmed}\n\n## Todos\n${newLine}\n`;
}

interface FormatArgs {
  readonly description: string;
  readonly hash: string;
  readonly addedDate: string;
  readonly phase?: string;
  readonly priority?: TodoPriority;
  readonly assignee?: string;
}

function formatTodoLine(args: FormatArgs): string {
  let line = `- [TODO] ${args.description} (added ${args.addedDate}) (ref:${args.hash})`;
  if (args.phase !== undefined) line += ` (phase:${args.phase})`;
  if (args.priority !== undefined) line += ` (priority:${args.priority})`;
  if (args.assignee !== undefined) line += ` (assignee:${args.assignee})`;
  return line;
}

async function atomicWriteFile(path: string, contents: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}
