/**
 * `apply_patch` patch-grammar parser — hand-rolled line-oriented state machine.
 *
 * Phase 03 plan 03-01 Task T1.
 *
 * **Source paraphrase only — no verbatim copy.** The grammar intent is
 * lifted from `codex-rs/core/src/tools/handlers/apply_patch.lark` (12 Lark
 * production rules) and the prose contract from
 * `codex-rs/apply-patch/apply_patch_tool_instructions.md`. Neither file's
 * text appears here; the parser implements the grammar from scratch.
 *
 * Public API:
 *   `parseApplyPatch(text)` → `ApplyPatchResult`.
 *
 * **Pure.** No fs, no IO, no side effects. The string-to-AST conversion is
 * deterministic; the execute callback in `apply-patch-tool.ts` owns the
 * filesystem dispatch.
 *
 * **Strict input contract:**
 *   - LF line endings only. CRLF (`\r\n`) anywhere → structured error.
 *   - File paths must be relative. A path starting with `/` → structured error.
 *   - At least one hunk between `*** Begin Patch` and `*** End Patch` is
 *     required (the grammar's `hunk+` rule).
 *   - `*** Add File:` requires every body line to start with `+`.
 *   - `*** End of File` is recognized only as the LAST line of an update
 *     hunk's body (signalling that the rest of the file should be deleted
 *     after the matched region).
 *   - Optional trailing LF after `*** End Patch`.
 *
 * State machine:
 *   EXPECT_BEGIN → IN_PATCH → IN_ADD | IN_UPDATE_HEAD | (delete consumed inline) → ...
 *
 * Each line is classified by sentinel prefix; the rest of the line is the
 * payload. The state machine transitions on sentinel hits and accumulates
 * the current hunk's body otherwise.
 */

export type FileOp =
  | { readonly kind: 'add'; readonly path: string; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'delete'; readonly path: string }
  | {
      readonly kind: 'update';
      readonly path: string;
      readonly moveTo?: string;
      readonly hunks: ReadonlyArray<Hunk>;
    };

export interface Hunk {
  /** Optional `@@` headers that scope the search context. May be empty. */
  readonly contexts: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<ChangeLine>;
  /** True if the hunk ends with `*** End of File` — truncate trailing file content. */
  readonly endOfFile: boolean;
}

export interface ChangeLine {
  readonly op: '+' | '-' | ' ';
  readonly text: string;
}

export type ApplyPatchResult =
  | { readonly ok: true; readonly ops: ReadonlyArray<FileOp> }
  | { readonly ok: false; readonly error: string; readonly line?: number };

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';
const END_OF_FILE = '*** End of File';
const HUNK_HEADER_BARE = '@@';
const HUNK_HEADER_WITH = '@@ ';

type State =
  | { readonly tag: 'EXPECT_BEGIN' }
  | { readonly tag: 'IN_PATCH' }
  | { readonly tag: 'IN_ADD'; readonly path: string; readonly lines: string[] }
  | {
      readonly tag: 'IN_UPDATE_HEAD';
      readonly path: string;
      moveTo: string | undefined;
      readonly hunks: Hunk[];
    }
  | {
      readonly tag: 'IN_CHANGE';
      readonly path: string;
      moveTo: string | undefined;
      readonly hunks: Hunk[];
      readonly currentContexts: string[];
      readonly currentLines: ChangeLine[];
      endOfFile: boolean;
    }
  | { readonly tag: 'DONE' };

function err(line: number, message: string): ApplyPatchResult {
  return { ok: false, error: message, line };
}

function assertRelative(path: string, lineNo: number): ApplyPatchResult | undefined {
  if (path.length === 0) {
    return err(lineNo, 'Empty file path');
  }
  if (path.startsWith('/')) {
    return err(lineNo, `Absolute path not allowed: ${path}`);
  }
  return undefined;
}

/**
 * Flush an in-progress IN_CHANGE state into a finalized Hunk and append to
 * the update op's hunks list. Returns the post-flush IN_UPDATE_HEAD state.
 */
function flushChangeIntoUpdate(
  s: Extract<State, { tag: 'IN_CHANGE' }>,
): Extract<State, { tag: 'IN_UPDATE_HEAD' }> {
  const hunk: Hunk = {
    contexts: s.currentContexts.slice(),
    lines: s.currentLines.slice(),
    endOfFile: s.endOfFile,
  };
  s.hunks.push(hunk);
  return { tag: 'IN_UPDATE_HEAD', path: s.path, moveTo: s.moveTo, hunks: s.hunks };
}

function finalizeUpdate(
  s: Extract<State, { tag: 'IN_UPDATE_HEAD' }>,
): Extract<FileOp, { kind: 'update' }> {
  const op: Extract<FileOp, { kind: 'update' }> = {
    kind: 'update',
    path: s.path,
    hunks: s.hunks.slice(),
    ...(s.moveTo !== undefined ? { moveTo: s.moveTo } : {}),
  };
  return op;
}

export function parseApplyPatch(text: string): ApplyPatchResult {
  if (text.includes('\r\n')) {
    // Reject CRLF anywhere. Pi 0.74 + Codex grammar are LF-only; CRLF would
    // misalign the line-state machine and silently mismatch context.
    const idx = text.indexOf('\r\n');
    const lineNo = text.slice(0, idx).split('\n').length;
    return err(lineNo, 'CRLF line endings are not allowed; use LF.');
  }

  // Trim a single optional trailing LF after the entire patch body. The
  // grammar permits `end_patch: "*** End Patch" LF?`. We split on LF and
  // ignore an empty final element to handle either "...End Patch" or
  // "...End Patch\n" identically.
  const rawLines = text.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  let state: State = { tag: 'EXPECT_BEGIN' };
  const ops: FileOp[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';
    const lineNo = i + 1;

    switch (state.tag) {
      case 'EXPECT_BEGIN': {
        if (line !== BEGIN_PATCH) {
          return err(lineNo, `Expected "${BEGIN_PATCH}", got: ${JSON.stringify(line)}`);
        }
        state = { tag: 'IN_PATCH' };
        break;
      }
      case 'IN_PATCH': {
        if (line === END_PATCH) {
          if (ops.length === 0) {
            return err(lineNo, 'Patch must contain at least one hunk (zero-hunk patch).');
          }
          state = { tag: 'DONE' };
          break;
        }
        if (line.startsWith(ADD_FILE)) {
          const path = line.slice(ADD_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          state = { tag: 'IN_ADD', path, lines: [] };
          break;
        }
        if (line.startsWith(DELETE_FILE)) {
          const path = line.slice(DELETE_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          ops.push({ kind: 'delete', path });
          // Stay in IN_PATCH — delete hunks consume exactly one line.
          break;
        }
        if (line.startsWith(UPDATE_FILE)) {
          const path = line.slice(UPDATE_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          state = { tag: 'IN_UPDATE_HEAD', path, moveTo: undefined, hunks: [] };
          break;
        }
        return err(lineNo, `Unexpected line inside patch body: ${JSON.stringify(line)}`);
      }
      case 'IN_ADD': {
        // Inside an add-file body, every line must begin with `+`. The body
        // terminates when we see another sentinel (Begin/End/Add/Delete/Update).
        if (
          line === END_PATCH ||
          line.startsWith(ADD_FILE) ||
          line.startsWith(DELETE_FILE) ||
          line.startsWith(UPDATE_FILE)
        ) {
          if (state.lines.length === 0) {
            return err(
              lineNo,
              `Add File hunk for ${state.path} must contain at least one "+" line.`,
            );
          }
          ops.push({ kind: 'add', path: state.path, lines: state.lines.slice() });
          // Re-process the current line under IN_PATCH state.
          state = { tag: 'IN_PATCH' };
          i--;
          break;
        }
        if (!line.startsWith('+')) {
          return err(
            lineNo,
            `Add File body line missing "+" prefix (file ${state.path}): ${JSON.stringify(line)}`,
          );
        }
        state.lines.push(line.slice(1));
        break;
      }
      case 'IN_UPDATE_HEAD': {
        // After "*** Update File: …": optional `*** Move to: …`, then 0+
        // hunks introduced by `@@`. Sentinels close the update.
        if (
          line === END_PATCH ||
          line.startsWith(ADD_FILE) ||
          line.startsWith(DELETE_FILE) ||
          line.startsWith(UPDATE_FILE)
        ) {
          ops.push(finalizeUpdate(state));
          state = { tag: 'IN_PATCH' };
          i--;
          break;
        }
        if (line.startsWith(MOVE_TO)) {
          if (state.moveTo !== undefined) {
            return err(lineNo, `Duplicate "*** Move to:" for file ${state.path}`);
          }
          if (state.hunks.length > 0) {
            return err(lineNo, `"*** Move to:" must precede any hunk body for ${state.path}`);
          }
          const target = line.slice(MOVE_TO.length);
          const e = assertRelative(target, lineNo);
          if (e !== undefined) return e;
          state.moveTo = target;
          break;
        }
        if (line === HUNK_HEADER_BARE || line.startsWith(HUNK_HEADER_WITH)) {
          // Begin a fresh IN_CHANGE block. Header text after "@@ " is
          // captured as a context annotation; multiple headers can stack.
          const ctx = line === HUNK_HEADER_BARE ? '' : line.slice(HUNK_HEADER_WITH.length);
          state = {
            tag: 'IN_CHANGE',
            path: state.path,
            moveTo: state.moveTo,
            hunks: state.hunks,
            currentContexts: [ctx],
            currentLines: [],
            endOfFile: false,
          };
          break;
        }
        return err(
          lineNo,
          `Unexpected line after "*** Update File: ${state.path}": ${JSON.stringify(line)}`,
        );
      }
      case 'IN_CHANGE': {
        // Sentinels close the current hunk + the surrounding update op.
        if (
          line === END_PATCH ||
          line.startsWith(ADD_FILE) ||
          line.startsWith(DELETE_FILE) ||
          line.startsWith(UPDATE_FILE)
        ) {
          if (state.currentLines.length === 0 && state.currentContexts.every((c) => c === '')) {
            return err(lineNo, `Update hunk for ${state.path} has no body or context lines.`);
          }
          const flushed = flushChangeIntoUpdate(state);
          ops.push(finalizeUpdate(flushed));
          state = { tag: 'IN_PATCH' };
          i--;
          break;
        }
        if (line === END_OF_FILE) {
          state.endOfFile = true;
          // Auto-flush this hunk and return to IN_UPDATE_HEAD — eof
          // terminates the current hunk body. The next sentinel (or hunk
          // header) opens fresh state.
          state = flushChangeIntoUpdate(state);
          break;
        }
        if (line === HUNK_HEADER_BARE || line.startsWith(HUNK_HEADER_WITH)) {
          // A second `@@` either stacks (when the current hunk has no body
          // yet — multi-level scope) or starts a new hunk (when the current
          // hunk already has body lines).
          const ctx = line === HUNK_HEADER_BARE ? '' : line.slice(HUNK_HEADER_WITH.length);
          if (state.currentLines.length === 0) {
            state.currentContexts.push(ctx);
            break;
          }
          // New hunk: flush + reset.
          const flushed = flushChangeIntoUpdate(state);
          state = {
            tag: 'IN_CHANGE',
            path: flushed.path,
            moveTo: flushed.moveTo,
            hunks: flushed.hunks,
            currentContexts: [ctx],
            currentLines: [],
            endOfFile: false,
          };
          break;
        }
        // Otherwise this is a change_line: first char is op, rest is text.
        const op = line.charAt(0);
        if (op === '+' || op === '-' || op === ' ') {
          state.currentLines.push({ op, text: line.slice(1) });
          break;
        }
        // An empty line — treat as a single-space context line (the
        // grammar permits zero-text payload after the op char, so a fully
        // empty line is technically malformed; surface as an error so the
        // model can re-emit with explicit " ").
        if (line.length === 0) {
          return err(
            lineNo,
            `Empty line inside update hunk for ${state.path}; use " " (space prefix) for blank context.`,
          );
        }
        return err(
          lineNo,
          `Update hunk line must start with "+", "-", or " " (file ${state.path}): ${JSON.stringify(line)}`,
        );
      }
      case 'DONE': {
        // The grammar permits an optional trailing LF; we already stripped
        // the single trailing empty element. Anything else past END_PATCH
        // is malformed.
        return err(lineNo, `Unexpected content after "${END_PATCH}": ${JSON.stringify(line)}`);
      }
    }
  }

  if (state.tag !== 'DONE') {
    return err(rawLines.length, `Patch ended before "${END_PATCH}".`);
  }
  if (ops.length === 0) {
    // Defensive — also covered by the IN_PATCH→END_PATCH branch.
    return err(rawLines.length, 'Patch contained zero file operations.');
  }
  return { ok: true, ops };
}
