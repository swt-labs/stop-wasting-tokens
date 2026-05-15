/**
 * `swt_complete_scope_seed` Pi custom-tool bridge (Phase 02 / Plan 02-01).
 *
 * The Scope mode's completion signal: after the orchestrator writes
 * ROADMAP.md (Scope Step 4), it calls this tool to delete the dashboard's
 * pre-seeded idea file at `.swt-planning/.pending-scope-idea.txt`. The
 * deletion is the contract that says "the seed has been successfully
 * consumed" — until this fires, the file lingers and the next cook bar
 * Enter overwrites it (most-recent-intent-wins per 02-CONTEXT.md).
 *
 * The tool's `execute()` is idempotent: calling it after the file is
 * already gone is a no-op (ENOENT swallowed). Any other errno re-throws
 * so genuine filesystem errors (EACCES, EISDIR, …) surface to the
 * orchestrator instead of silently leaving a stale seed file on disk.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ORCHESTRATOR-ONLY INVARIANT (READ BEFORE EXTENDING THIS MODULE)
 *
 *   `swt_complete_scope_seed` is registered on the ORCHESTRATOR session
 *   only — symmetric with `swt_ask_user` (see ./swt-ask-user-tool.ts).
 *   Spawned roles (dev/qa/scout/lead/architect/debugger/docs) MUST NOT
 *   receive this tool: a role-bound subagent has no business mutating the
 *   dashboard's scope-seed inbox. The invariant is enforced at three
 *   layers (mirroring swt_ask_user):
 *
 *     1. `spawnAgent` in `@swt-labs/orchestration` never includes this
 *        extension in its `extensions[]` list.
 *     2. `spawnOrchestratorSession` in `@swt-labs/orchestration` is the
 *        ONLY caller that wires this extension (Plan 02-01 Task 4).
 *     3. The mechanical A.6 regression test in
 *        `packages/runtime/test/ask-user/ask-user.test.ts` iterates
 *        `AGENT_ROLES` and asserts every non-orchestrator role excludes
 *        orchestrator-only tools.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * IPC contract (input → output):
 *
 *   Input  (no parameters — empty object schema):
 *     {}
 *
 *   Output:
 *     content: [{ type: 'text', text: 'seed file deleted' }]
 *     details: { ok: true }
 *
 * The tool's effect is purely filesystem: a single `unlinkSync` against
 * `<projectRoot>/.swt-planning/.pending-scope-idea.txt`. No
 * `pi.appendEntry` call — there is no journal obligation for the
 * deletion (parity with `swt_ask_user`'s execute(), which also does not
 * append). Per ADR-002, the tool factory closes over `pi` but never
 * uses `pi.appendEntry`.
 */

import { unlinkSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { PiExtensionAPI, PiToolExecuteResult } from '../extensions/pi-types.js';

/**
 * Tool name as registered on the Pi session. Exported as a typed constant
 * so the orchestrator-only A.6 regression test (and any future test that
 * wants to assert on the tool's presence/absence) can import the exact
 * string without duplicating the literal.
 */
export const SWT_COMPLETE_SCOPE_SEED_TOOL_NAME = 'swt_complete_scope_seed';

/**
 * JSON Schema for the tool's input — a zero-parameter object. Pi accepts
 * `{type:'object', properties:{}, additionalProperties:false}` as the
 * minimal valid empty-parameters schema; `required` is omitted when no
 * fields are required (matches research §C.5).
 */
const PARAMETERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export interface BuildSwtCompleteScopeSeedExtensionOptions {
  /**
   * Project root that owns the `.swt-planning/.pending-scope-idea.txt`
   * file the tool deletes. In production this is `io.cwd` from the cook
   * handler, threaded through `spawnOrchestratorSession`'s `opts.cwd`.
   */
  readonly projectRoot: string;
}

/**
 * Build the `swt_complete_scope_seed` Pi-extension factory. Pi loads the
 * extension at session start; the factory captures `pi` in closure scope
 * to call `pi.registerTool(...)`. The tool's `execute()` performs a
 * single idempotent `unlinkSync` against the seed file.
 */
export function buildSwtCompleteScopeSeedExtension(
  opts: BuildSwtCompleteScopeSeedExtensionOptions,
): (pi: PiExtensionAPI) => void {
  const seedPath = resolvePath(opts.projectRoot, '.swt-planning', '.pending-scope-idea.txt');
  return function swtCompleteScopeSeedExtension(pi: PiExtensionAPI): void {
    pi.registerTool({
      name: SWT_COMPLETE_SCOPE_SEED_TOOL_NAME,
      label: 'Mark the dashboard scope seed as consumed',
      description:
        'Delete the pending scope seed file at .swt-planning/.pending-scope-idea.txt after ROADMAP.md has been written. Idempotent — safe to call when the file is already absent. Orchestrator-only; call exactly once at the end of Scope Step 4.',
      promptSnippet:
        'swt_complete_scope_seed — signal that the dashboard pre-seeded idea has been consumed',
      promptGuidelines: [
        'Call this tool exactly once, AFTER ROADMAP.md has been written in Scope mode.',
        'Takes no parameters. Returns { ok: true } once the seed file is gone.',
        'Idempotent: calling on an already-deleted seed file is a no-op (no error).',
      ],
      parameters: PARAMETERS_JSON_SCHEMA,
      async execute(
        _toolCallId,
        _rawParams,
        _signal,
        _onUpdate,
        _ctx,
      ): Promise<PiToolExecuteResult> {
        try {
          unlinkSync(seedPath);
        } catch (e) {
          // ENOENT — file already gone (the orchestrator may retry on a
          // transient failure, or the user may have deleted the seed
          // manually). Idempotent: swallow and report success.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw e;
          }
        }
        return {
          content: [{ type: 'text', text: 'seed file deleted' }],
          details: { ok: true },
        };
      },
    });
  };
}
