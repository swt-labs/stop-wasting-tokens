/**
 * `swt_report_result` Pi Extension — ADR-002 reference implementation.
 *
 * Registers a custom tool the dispatched agent calls exactly once before
 * stopping. The tool:
 *
 *   1. Validates the payload against `TaskResultSchema` (Zod).
 *   2. Enriches `files_changed[]` with server-computed `sha256_after` +
 *      `bytes_after` so the LLM cannot forge artifact metadata.
 *   3. Calls **closure-captured `pi.appendEntry`** (NOT `ctx.appendEntry`)
 *      to persist a `swt-task-result` custom session entry.
 *   4. Returns `{ terminate: true }` so Pi skips the follow-up LLM call.
 *
 * A defensive `agent_end` hook writes a placeholder entry if the agent
 * ends without calling the tool — harvest never gets back "no entry."
 *
 * Per TDD2 §5.4 + §9.4 + ADR-002. The closure-captured-appendEntry
 * invariant is asserted by the structural type `PiExtensionContext` (no
 * `appendEntry` field) — a future contributor who writes
 * `ctx.appendEntry(...)` gets a TS error at compile time.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { TaskResultSchema } from '@swt-labs/shared';
import { z } from 'zod';

import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiSessionEntry,
  PiToolExecuteResult,
} from './pi-types.js';

export const SwtReportResultParamsSchema = z.object({
  status: z.enum(['success', 'failed', 'partial', 'blocked']),
  summary: z.string().min(1).max(4096),
  files_changed: z.array(
    z.object({
      path: z.string().min(1),
      action: z.enum(['created', 'modified', 'deleted']),
    }),
  ),
  must_haves: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(['passed', 'failed', 'skipped']),
      evidence: z.string().optional(),
    }),
  ),
  blockers: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type SwtReportResultParams = z.infer<typeof SwtReportResultParamsSchema>;

/**
 * JSON Schema shape handed to Pi's `registerTool`. Pi's `parameters` field
 * accepts a JSON-Schema-shaped record (per Pi docs); we hand-roll the
 * schema here rather than auto-generate it so the on-disk tool definition
 * stays auditable and stable across Zod patch versions.
 */
const PARAMETERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['status', 'summary', 'files_changed', 'must_haves'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['success', 'failed', 'partial', 'blocked'] },
    summary: { type: 'string', minLength: 1, maxLength: 4096 },
    files_changed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'action'],
        additionalProperties: false,
        properties: {
          path: { type: 'string', minLength: 1 },
          action: { type: 'string', enum: ['created', 'modified', 'deleted'] },
        },
      },
    },
    must_haves: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
          evidence: { type: 'string' },
        },
      },
    },
    blockers: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

/**
 * Walk `params.files_changed`, read each file (when it still exists; deleted
 * files report no sha/bytes), compute sha256 + byte length, and return a
 * `TaskResult`-shaped object. Trust boundary: the LLM reports the action,
 * we compute the artifact metadata server-side.
 */
export function enrichWithFileMetadata(
  cwd: string,
  params: SwtReportResultParams,
  taskId: string,
): unknown {
  const enrichedFiles = params.files_changed.map((file) => {
    if (file.action === 'deleted') {
      // Deleted files: no artifact metadata to record. Pi journal already
      // captures the pre-deletion state via the tool stream.
      return { path: file.path, action: file.action };
    }
    const absPath = resolve(cwd, file.path);
    try {
      const bytes = readFileSync(absPath);
      const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const bytes_after = statSync(absPath).size;
      return { path: file.path, action: file.action, sha256_after: sha256, bytes_after };
    } catch {
      // File reported created/modified but unreadable. Surface as-is —
      // the harvest-time TaskResultSchema permits absent sha256/bytes
      // so this still validates, but downstream consumers (dashboard)
      // can flag missing metadata.
      return { path: file.path, action: file.action };
    }
  });

  return {
    schema_version: 1,
    task_id: taskId,
    status: params.status,
    summary: params.summary,
    files_changed: enrichedFiles,
    must_haves: params.must_haves,
    ...(params.blockers !== undefined && params.blockers.length > 0
      ? { blockers: params.blockers }
      : {}),
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
  };
}

/**
 * Resolve the task id from the session's `task-context` custom entry.
 * Returns `'unknown'` when the entry is absent (test fixtures, recovery
 * paths) so the defensive harvester can still emit a placeholder.
 */
export function getTaskIdFromCtx(ctx: PiExtensionContext): string {
  const entries = ctx.sessionManager.getEntries();
  const ctxEntry = entries.find(
    (e: PiSessionEntry) => e.type === 'custom' && e.customType === 'task-context',
  );
  if (!ctxEntry || typeof ctxEntry.data !== 'object' || ctxEntry.data === null) {
    return 'unknown';
  }
  const data = ctxEntry.data as Record<string, unknown>;
  return typeof data['taskId'] === 'string' ? data['taskId'] : 'unknown';
}

export interface ResultProtocolExtensionOptions {
  /**
   * If true (default), register the defensive `agent_end` hook that writes
   * a placeholder result when the agent terminates without calling
   * `swt_report_result`. Tests that exercise the placeholder path
   * specifically can toggle this off.
   */
  readonly defensivePlaceholder?: boolean;
}

/**
 * Build the extension factory. The factory is the symbol Pi loads at
 * session-startup time; it captures `pi` in closure scope so the tool
 * implementation can call `pi.appendEntry(...)` without indirecting
 * through a context object.
 */
export function buildResultProtocolExtension(
  opts: ResultProtocolExtensionOptions = {},
): (pi: PiExtensionAPI) => void {
  const useDefensive = opts.defensivePlaceholder ?? true;
  return function resultProtocolExtension(pi: PiExtensionAPI): void {
    pi.registerTool<SwtReportResultParams>({
      name: 'swt_report_result',
      label: 'Report SWT task result',
      description:
        'Persist the SWT task result envelope before exiting. Call exactly once at the end of the task. After calling, do not produce more text.',
      promptSnippet: 'swt_report_result — finalize the task and exit',
      promptGuidelines: [
        'Call swt_report_result exactly once before stopping.',
        'After calling, do not produce more text.',
        'Set status="failed" with blockers[] populated if you cannot complete.',
      ],
      parameters: PARAMETERS_JSON_SCHEMA,
      async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx): Promise<PiToolExecuteResult> {
        // Defence: Pi may pre-validate but never assume it did. Re-parse
        // through Zod at the trust boundary so the harvester downstream
        // can rely on the shape.
        const params = SwtReportResultParamsSchema.parse(rawParams);
        const taskId = getTaskIdFromCtx(ctx);
        const enriched = enrichWithFileMetadata(ctx.cwd, params, taskId);

        // CRITICAL: `appendEntry` is on `pi` (ExtensionAPI), captured via
        // the surrounding closure. It is NOT on `ctx` (ExtensionContext).
        // The structural type `PiExtensionContext` has no `appendEntry`
        // field — any attempt to call `ctx.appendEntry(...)` is a TS error.
        pi.appendEntry('swt-task-result', enriched);

        return {
          content: [
            {
              type: 'text',
              text: `Task result recorded: ${params.status} (${params.must_haves.length} must-haves checked).`,
            },
          ],
          details: enriched,
          terminate: true,
        };
      },
    });

    if (useDefensive) {
      pi.on('agent_end', (_event, ctx) => {
        const entries = ctx.sessionManager.getEntries();
        const resultEntry = entries.find(
          (e: PiSessionEntry) => e.type === 'custom' && e.customType === 'swt-task-result',
        );
        if (resultEntry !== undefined) return;
        const taskId = getTaskIdFromCtx(ctx);
        pi.appendEntry('swt-task-result', {
          schema_version: 1,
          task_id: taskId,
          status: 'failed',
          summary: '(agent ended without calling swt_report_result)',
          files_changed: [],
          must_haves: [],
          blockers: ['protocol-violation: swt_report_result not called'],
        });
      });
    }
  };
}

/**
 * Default export — Pi's extension loader convention. Equivalent to
 * `buildResultProtocolExtension()` with default options.
 */
export default buildResultProtocolExtension();

// Re-export the Zod schema so test code + the orchestrator harvester can
// share a single shape contract. The runtime validator at the harvest
// boundary uses `TaskResultSchema` (broader: includes server-computed
// fields); this one is for the LLM-supplied params only.
export { TaskResultSchema };
