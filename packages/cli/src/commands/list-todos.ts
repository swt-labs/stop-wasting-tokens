/**
 * Plan 03-01 T4 — `swt list-todos` verb handler.
 *
 * Read-only verb that:
 *   1. Parses `STATE.md ## Todos` via `parseTodosFromState`,
 *   2. Applies repeatable `--filter key=value` tokens with AND semantics,
 *   3. Renders a numbered, status-iconified list to `io.stdout`, and
 *   4. Writes a session snapshot to
 *      `.swt-planning/.cache/list-todos-snapshot.json` that Phase 04's
 *      bare-integer cook resolver will consume.
 *
 * `--json` mode prints a machine-readable JSON envelope to stdout and
 * SKIPS the snapshot write (AC-05). The default mode always writes the
 * snapshot (even when the filtered list is empty — `refs: []`).
 *
 * All state changes are confined to the single snapshot file; STATE.md
 * and `.swt-planning/todo-details.json` are NEVER mutated by this verb.
 */

import { join } from 'node:path';

import {
  type ListTodosJsonOutput,
  type ListTodosSnapshot,
  type TodoEntry,
} from '@swt-labs/shared';

import { EXIT, type ExitCode } from '../exit-codes.js';
import {
  filterTodos,
  type ListTodosFilter,
  renderTodoList,
  writeListTodosSnapshot,
} from '../lib/list-todos-render.js';
import { parseTodosFromState } from '../lib/list-todos-state.js';
import type { CommandHandler, CommandIO } from '../router.js';

/**
 * Parse `--filter` tokens of the form `key=value` into a frozen
 * `Record<string, string>`. Returns `null` when no tokens are present
 * (matching the snapshot's `filter: null` contract for the unfiltered
 * default mode). Throws when any token is malformed (caller maps to
 * USAGE_ERROR).
 *
 * Multiple occurrences of the same key are merged left-to-right; the
 * last one wins. That mirrors Node's `parseArgs` AND-semantics for
 * `multiple: true` flags + matches the principle of least surprise for
 * a CLI user who typed `--filter phase=02 --filter phase=03` (the
 * second filter overrides — they almost certainly want the second).
 */
function parseFilterTokens(tokens: readonly string[] | undefined): ListTodosFilter | null {
  if (tokens === undefined || tokens.length === 0) return null;
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq <= 0 || eq === tok.length - 1) {
      throw new Error(`bad --filter token "${tok}" — expected "key=value"`);
    }
    out[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return out;
}

export const listTodosHandler: CommandHandler = async (
  parsed,
  io: CommandIO,
): Promise<ExitCode> => {
  // 1. Parse filter tokens. `--filter` is declared `multiple: true` in
  //    argv.ts, so `parsed.flags.filter` is `string[] | undefined`.
  const rawFilter = parsed.flags['filter'];
  const filterTokens = Array.isArray(rawFilter) ? rawFilter : undefined;
  let filter: ListTodosFilter | null;
  try {
    filter = parseFilterTokens(filterTokens);
  } catch (err) {
    io.stderr.write(
      `swt list-todos: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    io.stderr.write('  Usage: swt list-todos [--filter key=value ...] [--json]\n');
    return EXIT.USAGE_ERROR;
  }
  const jsonMode = parsed.flags['json'] === true;

  // 2. Locate STATE.md and parse the `## Todos` section.
  const planningRoot = join(io.cwd, '.swt-planning');
  const statePath = join(planningRoot, 'STATE.md');
  let entries: TodoEntry[];
  try {
    entries = await parseTodosFromState(statePath);
  } catch (err) {
    io.stderr.write(
      `swt list-todos: failed to read STATE.md: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }

  // 3. Apply filter.
  const filtered = filterTodos(entries, filter);

  const generated_at = new Date().toISOString();

  // 4. --json: print JSON, SKIP snapshot write (AC-05).
  if (jsonMode) {
    const payload: ListTodosJsonOutput = {
      schema_version: 1,
      generated_at,
      filter,
      entries: [...filtered],
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return EXIT.SUCCESS;
  }

  // 5. Default mode: render to stdout + write session snapshot.
  io.stdout.write(renderTodoList(filtered));
  const snapshot: ListTodosSnapshot = {
    schema_version: 1,
    generated_at,
    filter,
    refs: filtered.map((e) => e.ref),
  };
  try {
    await writeListTodosSnapshot(planningRoot, snapshot);
  } catch (err) {
    io.stderr.write(
      `swt list-todos: failed to write snapshot: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }
  return EXIT.SUCCESS;
};
