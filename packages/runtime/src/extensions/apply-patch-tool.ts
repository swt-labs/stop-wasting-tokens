/**
 * `apply_patch` Pi extension — JSON-schema tool whose execute callback
 * dispatches the parsed patch directly via Node.js `fs` APIs.
 *
 * Phase 03 plan 03-01 T2.
 *
 * **Grammar source:** `codex-rs/apply-patch/apply_patch_tool_instructions.md`
 * and `codex-rs/core/src/tools/handlers/apply_patch.lark`. The description
 * below paraphrases the intent — no upstream text is copied verbatim. The
 * citation tail anchors future maintainers to the source so the contract
 * can be replayed if upstream drifts.
 *
 * **Pi 0.74 surface (Scout Q1):** Pi has no freeform/grammar tool variant.
 * `apply_patch` is registered as a JSON-schema custom tool with a single
 * `patch: string` parameter; the patch body is parsed server-side by
 * `parseApplyPatch` and applied via direct fs IO. This bypasses Scout's
 * Q5/risk-2 open question (re-entering Pi's built-in `edit` tool from
 * inside an extension's execute handler is not part of the supported API
 * surface) and keeps the execute path testable with injectable fs.
 *
 * **Closure-captured fs deps (Scout Q5 / test seam):** the factory accepts
 * an optional `{ fs }` injection so tests can drive the apply path against
 * an in-memory shim. Production calls fall through to Node's synchronous
 * `fs.readFileSync` / `fs.writeFileSync` / `fs.unlinkSync` / `fs.existsSync`.
 */

import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  unlinkSync as nodeUnlinkSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { parseApplyPatch, type FileOp, type Hunk } from './apply-patch-parser.js';
import type { PiExtensionAPI, PiToolExecuteResult } from './pi-types.js';

/**
 * Minimal fs surface the apply path needs. Production wires Node `fs`;
 * tests inject an in-memory shim. Synchronous to match the Codex apply
 * semantics (one tool call applies the whole patch transactionally).
 */
export interface ApplyPatchFs {
  readFileSync(path: string): string;
  writeFileSync(path: string, body: string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
}

const DEFAULT_FS: ApplyPatchFs = {
  readFileSync: (p) => nodeReadFileSync(p, 'utf8'),
  writeFileSync: (p, b) => nodeWriteFileSync(p, b, 'utf8'),
  unlinkSync: (p) => nodeUnlinkSync(p),
  existsSync: (p) => nodeExistsSync(p),
};

export interface BuildApplyPatchExtensionOptions {
  /** Injectable fs surface for tests. Defaults to Node's synchronous fs. */
  readonly fs?: ApplyPatchFs;
  /**
   * Working directory the patch paths are resolved against. Production
   * callers omit and the execute callback reads it from the Pi extension
   * context's `cwd`. Tests can pin it for hermetic runs.
   */
  readonly cwd?: string;
}

export const APPLY_PATCH_TOOL_NAME = 'apply_patch';

/**
 * Tool description — paraphrased intent of the upstream grammar
 * instructions. Future maintainers replaying drift should compare against
 * the citation tail's source path. No verbatim chunks from upstream.
 */
const TOOL_DESCRIPTION = [
  'Apply a structured file-edit patch in the apply_patch grammar.',
  '',
  'Envelope:',
  '  *** Begin Patch',
  '  [ one or more file sections ]',
  '  *** End Patch',
  '',
  'Each file section starts with exactly one header:',
  '  *** Add File: <relative path>    — create a new file; every body line begins with "+"',
  '  *** Delete File: <relative path> — remove an existing file; no body',
  '  *** Update File: <relative path> — edit in place; may be immediately followed by',
  '       *** Move to: <new relative path>   (optional rename)',
  '       then zero or more hunks introduced by @@ (optionally @@ <scope-annotation>).',
  '',
  'Inside an update hunk each line begins with " ", "-", or "+". Use " "',
  'for unchanged context lines, "-" to remove, "+" to insert. A hunk may end',
  'with the sentinel line "*** End of File" to indicate the rest of the file',
  'should be discarded after the matched region.',
  '',
  'Rules:',
  '  - All paths must be relative. Absolute paths (starting with "/") are rejected.',
  '  - LF line endings only. CRLF is rejected.',
  '  - Patches must contain at least one file section.',
  '  - Provide a SINGLE string for the "patch" parameter — the whole envelope.',
  '',
  '(Grammar source: codex-rs/apply-patch/apply_patch_tool_instructions.md —',
  'paraphrased; intent lifted, no verbatim text copied.)',
].join('\n');

const PARAMETERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['patch'],
  additionalProperties: false,
  properties: {
    patch: {
      type: 'string',
      description:
        'The patch body in apply_patch grammar. Single string; must include Begin/End sentinels.',
    },
  },
};

interface ApplyPatchParams {
  readonly patch: string;
}

interface ApplyStats {
  add: number;
  update: number;
  delete: number;
}

function pathInsideCwd(cwd: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    // Defence-in-depth: the parser already rejects absolute paths, but the
    // execute callback re-asserts so a future parser regression cannot
    // silently bypass the guard.
    throw new Error(`apply_patch: absolute path rejected: ${relPath}`);
  }
  return resolve(cwd, relPath);
}

function applyAdd(fs: ApplyPatchFs, cwd: string, path: string, lines: ReadonlyArray<string>): void {
  const target = pathInsideCwd(cwd, path);
  if (fs.existsSync(target)) {
    throw new Error(`apply_patch: Add File target already exists: ${path}`);
  }
  // Add hunks have at least one line by grammar; rendering with a trailing
  // newline matches the Codex semantics (each "+ <text>\n" round-trips into
  // a file body that ends with LF).
  const body = lines.length === 0 ? '' : lines.join('\n') + '\n';
  fs.writeFileSync(target, body);
}

function applyDelete(fs: ApplyPatchFs, cwd: string, path: string): void {
  const target = pathInsideCwd(cwd, path);
  if (!fs.existsSync(target)) {
    throw new Error(`apply_patch: Delete File target does not exist: ${path}`);
  }
  fs.unlinkSync(target);
}

function applyHunkToContent(content: string, hunk: Hunk, path: string): string {
  // Reconstruct the "before" block (context + removals) and the "after"
  // block (context + insertions). Locate the "before" as a substring in
  // the current file content; replace with "after".
  //
  // Lines marked '+' are insert-only and never appear in "before".
  // Lines marked '-' are remove-only and never appear in "after".
  // Lines marked ' ' appear in both with their text unchanged.
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (const cl of hunk.lines) {
    if (cl.op === ' ') {
      beforeLines.push(cl.text);
      afterLines.push(cl.text);
    } else if (cl.op === '-') {
      beforeLines.push(cl.text);
    } else {
      afterLines.push(cl.text);
    }
  }

  // Hunk may carry zero "before" lines — that means "insert at start of
  // file". Treat the empty before-block as anchored to position 0.
  const before = beforeLines.join('\n');
  const after = afterLines.join('\n');

  if (before === '') {
    // Pure insertion at start; preserve file body afterwards.
    return after === '' ? content : after + (content.length > 0 ? '\n' + content : '');
  }

  const idx = content.indexOf(before);
  if (idx < 0) {
    throw new Error(
      `apply_patch: hunk context not found in ${path} (could not locate ${beforeLines.length}-line block).`,
    );
  }
  const head = content.slice(0, idx);
  const tail = content.slice(idx + before.length);

  if (hunk.endOfFile) {
    // The "*** End of File" sentinel means the matched region runs to the
    // end of the file — discard whatever was after it.
    return head + after;
  }
  return head + after + tail;
}

function applyUpdate(fs: ApplyPatchFs, cwd: string, op: Extract<FileOp, { kind: 'update' }>): void {
  const sourcePath = pathInsideCwd(cwd, op.path);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`apply_patch: Update File source does not exist: ${op.path}`);
  }

  let content = fs.readFileSync(sourcePath);
  for (const hunk of op.hunks) {
    content = applyHunkToContent(content, hunk, op.path);
  }

  if (op.moveTo !== undefined) {
    const targetPath = pathInsideCwd(cwd, op.moveTo);
    if (fs.existsSync(targetPath) && targetPath !== sourcePath) {
      throw new Error(`apply_patch: Move target already exists: ${op.moveTo}`);
    }
    fs.writeFileSync(targetPath, content);
    if (targetPath !== sourcePath) {
      fs.unlinkSync(sourcePath);
    }
  } else {
    fs.writeFileSync(sourcePath, content);
  }
}

function applyOps(fs: ApplyPatchFs, cwd: string, ops: ReadonlyArray<FileOp>): ApplyStats {
  const stats: ApplyStats = { add: 0, update: 0, delete: 0 };
  for (const op of ops) {
    if (op.kind === 'add') {
      applyAdd(fs, cwd, op.path, op.lines);
      stats.add += 1;
    } else if (op.kind === 'delete') {
      applyDelete(fs, cwd, op.path);
      stats.delete += 1;
    } else {
      applyUpdate(fs, cwd, op);
      stats.update += 1;
    }
  }
  return stats;
}

/**
 * Build the `apply_patch` extension factory. Mirrors the
 * `buildResultProtocolExtension` / `buildSwtAskUserExtension` shape:
 *   `(opts?) => (pi: PiExtensionAPI) => void`.
 *
 * Production omits `opts`. Tests inject `{ fs, cwd }` to drive the apply
 * path against a hermetic shim.
 */
export function buildApplyPatchExtension(
  opts: BuildApplyPatchExtensionOptions = {},
): (pi: PiExtensionAPI) => void {
  const fs = opts.fs ?? DEFAULT_FS;
  const fixedCwd = opts.cwd;
  return function applyPatchExtension(pi: PiExtensionAPI): void {
    pi.registerTool<ApplyPatchParams>({
      name: APPLY_PATCH_TOOL_NAME,
      label: 'Apply a structured file-edit patch',
      description: TOOL_DESCRIPTION,
      promptSnippet: 'apply_patch — apply a multi-file diff in the apply_patch grammar in one call',
      promptGuidelines: [
        'Always wrap the patch in "*** Begin Patch" … "*** End Patch".',
        'Use one *** Add/Delete/Update File: <relative path> header per file section.',
        'Inside an update hunk, prefix every line with " ", "-", or "+".',
        'Paths must be relative; absolute paths are rejected.',
      ],
      parameters: PARAMETERS_JSON_SCHEMA,
      async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx): Promise<PiToolExecuteResult> {
        // Pi's runtime validator may pre-check the JSON shape; we still
        // guard the string-presence here in case a non-validating Pi
        // patch release passes through.
        const params = rawParams as Partial<ApplyPatchParams>;
        if (typeof params.patch !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'apply_patch: missing or non-string "patch" parameter.',
              },
            ],
          };
        }
        const parsed = parseApplyPatch(params.patch);
        if (!parsed.ok) {
          const lineSuffix = parsed.line !== undefined ? ` (line ${parsed.line})` : '';
          return {
            content: [
              {
                type: 'text',
                text: `apply_patch: parse error${lineSuffix}: ${parsed.error}`,
              },
            ],
          };
        }
        const cwd = fixedCwd ?? ctx.cwd;
        try {
          const stats = applyOps(fs, cwd, parsed.ops);
          const total = stats.add + stats.update + stats.delete;
          return {
            content: [
              {
                type: 'text',
                text: `Applied ${total} file op${total === 1 ? '' : 's'} (${stats.add} add / ${stats.update} update / ${stats.delete} delete).`,
              },
            ],
            details: { ...stats, total },
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `apply_patch: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    });
  };
}

/**
 * Default extension instance — equivalent to `buildApplyPatchExtension()`
 * with no overrides. Symmetric with `swtAskUserExtension` /
 * `resultProtocolExtension` defaults.
 */
export default buildApplyPatchExtension();
