import { z } from 'zod';

/**
 * Result envelope a dispatched agent emits via the `swt_report_result`
 * Extension custom tool (ADR-002). Validated at the harvest boundary in
 * `orchestration/src/result-harvest.ts` (Plan 01-02 PR-09).
 *
 * Schema version 1 — locked in here in PR-04. Future incompatible changes
 * bump `schema_version` and migrate via a sibling schema (`task-result.v2.ts`).
 *
 * Per TDD2 §9.4. The TS surface `TaskResult` (in `shared/src/types/dispatcher.ts`)
 * mirrors this schema's inferred shape so compile-time consumers don't have to
 * import Zod just to read the type.
 */
export const TaskResultSchema = z.object({
  schema_version: z.literal(1),
  task_id: z.string().min(1),
  status: z.enum(['success', 'failed', 'partial', 'blocked']),
  summary: z.string().min(1).max(4096),
  files_changed: z.array(
    z.object({
      path: z.string().min(1),
      action: z.enum(['created', 'modified', 'deleted']),
      sha256_after: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/)
        .optional(),
      bytes_after: z.number().int().nonnegative().optional(),
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

export type TaskResultSchemaT = z.infer<typeof TaskResultSchema>;
