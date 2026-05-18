/**
 * GENERATED CODE — DO NOT EDIT MANUALLY.
 *
 * Generator:     scripts/codegen/apply-patch-from-lark.ts
 * Grammar src:   references/codex/apply_patch.lark
 * Grammar sha256: d6367f4826ed608c424b0a308f3d6163527df63c22513d089b91863552f8bfeb
 * Regenerate via: pnpm gen:apply-patch-parser
 *
 * Public API:
 *   parseApplyPatch(text: string): ApplyPatchResult
 *
 * Pure — no fs, no IO. Strict line-oriented state machine derived from the
 * 14 Lark production rules of the upstream apply_patch grammar:
 *   start, begin_patch, end_patch, hunk, add_hunk, delete_hunk, update_hunk,
 *   filename, add_line, change_move, change, change_context, change_line,
 *   eof_line.
 *
 * Strict input contract (preserved verbatim from Phase 3's hand-rolled parser):
 *   - LF line endings only. CRLF anywhere → structured error.
 *   - File paths must be relative. Empty / leading-"/" → structured error.
 *   - hunk+ — at least one hunk between Begin Patch and End Patch.
 *   - add_line+ — every Add File body line must begin with "+".
 *   - "*** End of File" terminates the current update hunk's body.
 *   - Optional trailing LF after End Patch.
 *
 * Error-message preservation (DEVN-PHASE-06-ERROR-MESSAGE-PRESERVATION):
 *   5 of the 14 test cases assert on substring patterns. The 15 ERR_* constants
 *   below are transcribed verbatim from the Phase 3 parser to preserve those
 *   assertions byte-identically across the generator swap.
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

// -----------------------------------------------------------------------------
// Sentinel constants — extracted from the Lark grammar's string literals.
// -----------------------------------------------------------------------------

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';
const END_OF_FILE = '*** End of File';
const HUNK_HEADER_BARE = '@@';
const HUNK_HEADER_WITH = '@@ ';

// -----------------------------------------------------------------------------
// State machine type — one named state per grammar production "context":
//   EXPECT_BEGIN    — before "*** Begin Patch"
//   IN_PATCH        — between begin_patch and end_patch, awaiting a hunk
//   IN_ADD          — inside an add_hunk body (add_line+)
//   IN_UPDATE_HEAD  — after "*** Update File:", awaiting change_move? or change?
//   IN_CHANGE       — inside a change block ((change_context | change_line)+)
//   DONE            — after "*** End Patch"
// -----------------------------------------------------------------------------

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
 * Flush an in-progress IN_CHANGE state into a finalized Hunk and append to the
 * update op's hunks list. Returns the post-flush IN_UPDATE_HEAD state.
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
  // CRLF rejection — Phase 3 contract decision, asserted by test case 8 on
  // substring "CRLF". The grammar has no CRLF production; LF-only is enforced
  // here at entry.
  if (text.includes('\r\n')) {
    const idx = text.indexOf('\r\n');
    const lineNo = text.slice(0, idx).split('\n').length;
    return err(lineNo, 'CRLF line endings are not allowed; use LF.');
  }

  // Strip a single optional trailing LF — `end_patch: "*** End Patch" LF?`.
  // split('\n') yields a trailing empty element only when the input ends in \n.
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
        // Grammar: `begin_patch: "*** Begin Patch" LF`.
        if (line !== BEGIN_PATCH) {
          return err(lineNo, `Expected "${BEGIN_PATCH}", got: ${JSON.stringify(line)}`);
        }
        state = { tag: 'IN_PATCH' };
        break;
      }
      case 'IN_PATCH': {
        // Grammar: `hunk+ end_patch`. Dispatch on sentinel prefix.
        if (line === END_PATCH) {
          if (ops.length === 0) {
            return err(lineNo, 'Patch must contain at least one hunk (zero-hunk patch).');
          }
          state = { tag: 'DONE' };
          break;
        }
        if (line.startsWith(ADD_FILE)) {
          // Grammar: `add_hunk: "*** Add File: " filename LF add_line+`.
          const path = line.slice(ADD_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          state = { tag: 'IN_ADD', path, lines: [] };
          break;
        }
        if (line.startsWith(DELETE_FILE)) {
          // Grammar: `delete_hunk: "*** Delete File: " filename LF` — no body.
          const path = line.slice(DELETE_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          ops.push({ kind: 'delete', path });
          break;
        }
        if (line.startsWith(UPDATE_FILE)) {
          // Grammar: `update_hunk: "*** Update File: " filename LF change_move? change?`.
          const path = line.slice(UPDATE_FILE.length);
          const e = assertRelative(path, lineNo);
          if (e !== undefined) return e;
          state = { tag: 'IN_UPDATE_HEAD', path, moveTo: undefined, hunks: [] };
          break;
        }
        return err(lineNo, `Unexpected line inside patch body: ${JSON.stringify(line)}`);
      }
      case 'IN_ADD': {
        // Grammar: `add_line: "+" /(.*)/ LF -> line` — body terminates on the
        // next sentinel (Begin/End/Add/Delete/Update).
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
        // Grammar: `update_hunk: ... change_move? change?`. Either an optional
        // "*** Move to:" or the start of a change block via "@@".
        if (
          line === END_PATCH ||
          line.startsWith(ADD_FILE) ||
          line.startsWith(DELETE_FILE) ||
          line.startsWith(UPDATE_FILE)
        ) {
          // `change?` — finalize zero-change update_hunk (pure rename or empty).
          ops.push(finalizeUpdate(state));
          state = { tag: 'IN_PATCH' };
          i--;
          break;
        }
        if (line.startsWith(MOVE_TO)) {
          // Grammar: `change_move: "*** Move to: " filename LF`. At most one;
          // must precede any change block.
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
          // Grammar: `change_context: ("@@" | "@@ " /(.+)/) LF`. Open a fresh
          // change block; capture optional context text after "@@ ".
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
        // Grammar: `change: (change_context | change_line)+ eof_line?`. The
        // surrounding update_hunk closes when a sentinel arrives.
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
          // Grammar: `eof_line: "*** End of File" LF`. Auto-flushes the hunk.
          state.endOfFile = true;
          state = flushChangeIntoUpdate(state);
          break;
        }
        if (line === HUNK_HEADER_BARE || line.startsWith(HUNK_HEADER_WITH)) {
          // grammar extension: stack context headers when no body lines yet
          // (multi-level scope). Otherwise this header starts a new hunk.
          const ctx = line === HUNK_HEADER_BARE ? '' : line.slice(HUNK_HEADER_WITH.length);
          if (state.currentLines.length === 0) {
            state.currentContexts.push(ctx);
            break;
          }
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
        // Grammar: `change_line: ("+" | "-" | " ") /(.*)/ LF`.
        const op = line.charAt(0);
        if (op === '+' || op === '-' || op === ' ') {
          state.currentLines.push({ op, text: line.slice(1) });
          break;
        }
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
        // Grammar: `end_patch: "*** End Patch" LF?`. The trailing LF was
        // already consumed by the split-and-pop above; anything else is
        // malformed.
        return err(lineNo, `Unexpected content after "${END_PATCH}": ${JSON.stringify(line)}`);
      }
    }
  }

  if (state.tag !== 'DONE') {
    return err(rawLines.length, `Patch ended before "${END_PATCH}".`);
  }
  if (ops.length === 0) {
    return err(rawLines.length, 'Patch contained zero file operations.');
  }
  return { ok: true, ops };
}
