/**
 * Plan 15-02-01 T3 — `swt todo "<description>"` verb handler.
 *
 * Appends a `- [TODO] ...` entry to `STATE.md ## Todos` via the
 * `todo-state` helper, and (when any optional sidecar field is provided)
 * persists the same data to `.swt-planning/todo-details.json` keyed by
 * the 8-char sha256 prefix of the description. Idempotent: re-running
 * with the same description is a no-op (no duplicate STATE.md line and
 * no rewrite of the sidecar).
 *
 * Replaces the v3 stub registration in `STUB_SPECS` that returned
 * `EXIT.NOT_IMPLEMENTED`. See plan 15-02-01 + commands.md Part 6
 * Milestone B-01 for the spec.
 */

import { join } from 'node:path';

import { type TodoDetail, TODO_PRIORITY_VALUES, type TodoPriority } from '@swt-labs/shared';

import { EXIT, type ExitCode } from '../exit-codes.js';
import {
  appendTodoToState,
  computeTodoHash,
  todoExistsInState,
  writeTodoDetail,
} from '../lib/todo-state.js';
import type { CommandHandler, CommandIO } from '../router.js';

const PHASE_REGEX = /^[0-9]{2}$/;

function asString(value: string | string[] | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isTodoPriority(value: string): value is TodoPriority {
  return (TODO_PRIORITY_VALUES as readonly string[]).includes(value);
}

export const todoHandler: CommandHandler = async (parsed, io: CommandIO): Promise<ExitCode> => {
  // 1. Description from positionals — accept space-separated tokens
  //    that the shell passed to us as separate argv entries, but the
  //    canonical form is a quoted single positional ("fix login bug").
  const description = parsed.positionals.join(' ').trim();
  if (description.length < 3) {
    io.stderr.write('swt todo: description must be at least 3 characters\n');
    io.stderr.write('  Usage: swt todo "<description>" [flags]\n');
    return EXIT.USAGE_ERROR;
  }

  // 2. Optional flags — `--detail`, `--phase`, `--files`, `--priority`,
  //    `--assignee`. argv parser already maps these to strings on
  //    parsed.flags (description / phase / assignee), but `files` and
  //    `priority` are NOT declared in the global parser. The parser is
  //    strict, so undeclared flags would have thrown earlier — this
  //    handler does NOT register them in the global parser to keep the
  //    parallel-safety footprint tiny. Until the parser is widened
  //    (Phase 03 / 04), `--detail`, `--files`, `--priority`, `--assignee`
  //    are surfaced via env vars (see below), with `--phase` taking
  //    its existing declared form. We still read them off `parsed.flags`
  //    in case future parser additions make them first-class.
  const detail = asString(parsed.flags['detail']);
  const phase = asString(parsed.flags['phase']);
  const filesCsv = asString(parsed.flags['files']);
  const priorityRaw = asString(parsed.flags['priority']);
  const assignee = asString(parsed.flags['assignee']);

  if (phase !== undefined && !PHASE_REGEX.test(phase)) {
    io.stderr.write(`swt todo: --phase must match /^[0-9]{2}$/ (got "${phase}")\n`);
    return EXIT.USAGE_ERROR;
  }
  let priority: TodoPriority | undefined;
  if (priorityRaw !== undefined) {
    if (!isTodoPriority(priorityRaw)) {
      io.stderr.write(
        `swt todo: --priority must be one of high|medium|low (got "${priorityRaw}")\n`,
      );
      return EXIT.USAGE_ERROR;
    }
    priority = priorityRaw;
  }
  const files =
    filesCsv === undefined
      ? undefined
      : filesCsv
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

  // 3. Compute hash and resolve the planning paths.
  const hash = computeTodoHash(description);
  const planningRoot = join(io.cwd, '.swt-planning');
  const statePath = join(planningRoot, 'STATE.md');

  // 4. Idempotency check — if the hash is already in STATE.md ##
  //    Todos, exit 0 with a note. Do not touch todo-details.json.
  try {
    if (await todoExistsInState(statePath, hash)) {
      io.stdout.write(`Todo already exists: ${hash}\n`);
      return EXIT.SUCCESS;
    }
  } catch (err) {
    io.stderr.write(
      `swt todo: failed to read STATE.md: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }

  // 5. Append to STATE.md. Atomic write-temp-rename inside the helper.
  try {
    await appendTodoToState({
      statePath,
      description,
      hash,
      phase,
      priority,
      assignee,
    });
  } catch (err) {
    io.stderr.write(
      `swt todo: failed to append to STATE.md: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }

  // 6. If any sidecar field was provided, write the typed detail row.
  const hasSidecar =
    detail !== undefined ||
    phase !== undefined ||
    files !== undefined ||
    priority !== undefined ||
    assignee !== undefined;
  if (hasSidecar) {
    const detailRow: TodoDetail = {
      description,
      ...(detail !== undefined ? { detail } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(files !== undefined ? { files } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(assignee !== undefined ? { assignee } : {}),
      created_at: new Date().toISOString(),
    };
    try {
      await writeTodoDetail(planningRoot, hash, detailRow);
    } catch (err) {
      io.stderr.write(
        `swt todo: failed to write todo-details.json: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
  }

  io.stdout.write(`Added todo: ${hash} — ${description}\n`);
  return EXIT.SUCCESS;
};
