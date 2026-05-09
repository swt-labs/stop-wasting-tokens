import { z } from 'zod';

import { SnapshotEventSchema } from './events.js';
import { SnapshotSchema } from './snapshot.js';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime_ms: z.number().int().nonnegative(),
  schema_version: z.literal('1'),
  /**
   * SWT version the daemon is running. Sourced from the CLI's CURRENT_VERSION
   * via the `SWT_DASHBOARD_DAEMON_VERSION` env var the CLI sets when spawning
   * the daemon. Optional for back-compat with v1.6.0–v1.6.7 daemons that
   * don't emit it; v1.7.0+ always does.
   */
  daemon_version: z.string().min(1).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const DebugEmitBodySchema = SnapshotEventSchema;
export type DebugEmitBody = z.infer<typeof DebugEmitBodySchema>;

export const DebugEmitResponseSchema = z.object({
  queued: z.literal(true),
});
export type DebugEmitResponse = z.infer<typeof DebugEmitResponseSchema>;

export const UatCheckpointBodySchema = z.object({
  scenario: z.string().min(1),
  result: z.enum(['pass', 'fail']),
  note: z.string().optional(),
});
export type UatCheckpointBody = z.infer<typeof UatCheckpointBodySchema>;

export const UatCheckpointResponseSchema = z.object({
  saved: z.literal(true),
  path: z.string().min(1),
});
export type UatCheckpointResponse = z.infer<typeof UatCheckpointResponseSchema>;

export const InitBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type InitBody = z.infer<typeof InitBodySchema>;

export const InitResponseSchema = z.object({
  initialized: z.literal(true),
  root: z.string().min(1),
  files: z.array(z.string().min(1)),
  /**
   * The snapshot the daemon's just-spun-up snapshotter produced. Lets the
   * client drop the redundant follow-up `GET /api/snapshot` round-trip.
   * Optional for back-compat with v1.6.0–v1.6.7 daemons that don't emit it.
   */
  snapshot: SnapshotSchema.optional(),
});
export type InitResponse = z.infer<typeof InitResponseSchema>;

export const CommandBodySchema = z.object({
  input: z.string().min(1).max(500),
});
export type CommandBody = z.infer<typeof CommandBodySchema>;

/**
 * How the dashboard's command-bar router decided to handle the input.
 *
 * - `literal` — first token matched the non-interactive allowlist; the
 *   server spawned `swt <argv>` and the response carries the spawn result.
 * - `rejected_interactive` — first token is a known interactive verb
 *   (vibe / watch / dashboard); the server returned a structured rejection
 *   without spawning, because the route closes stdin and would block.
 * - `rejected_unknown` — first token is neither in the allowlist nor in
 *   the interactive list (typos, natural language, stub verbs); rejected
 *   with a hint pointing at the allowlist.
 *
 * Default `'literal'` preserves back-compat with v1.6.0–v1.6.5 clients
 * that don't know about routing decisions.
 */
export const RoutingDecisionSchema = z.enum([
  'literal',
  'rejected_interactive',
  'rejected_unknown',
]);
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const CommandResponseSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  /** Routing decision for the input. Defaults to 'literal' for back-compat. */
  routing_decision: RoutingDecisionSchema.default('literal'),
  /** First whitespace token of the input, lowercased. Null when input was empty. */
  verb: z.string().nullable().default(null),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export const ApiSchemas = {
  '/api/health': {
    method: 'GET',
    response: HealthResponseSchema,
  },
  '/api/_debug/emit': {
    method: 'POST',
    body: DebugEmitBodySchema,
    response: DebugEmitResponseSchema,
  },
  '/api/events': {
    method: 'GET',
    sse: SnapshotEventSchema,
  },
  '/api/uat/:phase/checkpoint': {
    method: 'POST',
    body: UatCheckpointBodySchema,
    response: UatCheckpointResponseSchema,
  },
  '/api/init': {
    method: 'POST',
    body: InitBodySchema,
    response: InitResponseSchema,
  },
  '/api/command': {
    method: 'POST',
    body: CommandBodySchema,
    response: CommandResponseSchema,
  },
} as const;
export type ApiSchemaMap = typeof ApiSchemas;
