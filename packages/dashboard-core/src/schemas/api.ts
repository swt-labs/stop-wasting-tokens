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

export const VibeStartBodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  project_context: z.record(z.unknown()).optional(),
  prompt_timeouts: z
    .object({
      clarification_ms: z.number().int().positive().optional(),
      permission_ms: z.number().int().positive().optional(),
    })
    .optional(),
});
export type VibeStartBody = z.infer<typeof VibeStartBodySchema>;

export const VibeStartResponseSchema = z.object({
  session_id: z.string().min(1),
  state: z.enum(['idle', 'running', 'awaiting-reply', 'completed', 'failed', 'expired']),
  /**
   * Whether the daemon has an agent backend configured. When `'none'`, the
   * session was created but no agent will run — the caller saw idle-state
   * and should surface a setup hint to the user. v2.0 ships with codex
   * agents gated behind `SWT_VIBE_AGENT=codex` opt-in, so the default
   * behavior of `swt dashboard` returns `'none'` until the env var is set.
   * Optional for back-compat with v2.0.0 daemons that don't emit it.
   */
  agent_backend: z.enum(['none', 'codex', 'scripted']).optional(),
});
export type VibeStartResponse = z.infer<typeof VibeStartResponseSchema>;

export const VibeReplyBodySchema = z.object({
  prompt_id: z.string().min(1),
  answer: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('choice'), value: z.string().min(1) }),
    z.object({ kind: z.literal('free_form'), text: z.string().min(1) }),
    z.object({
      kind: z.literal('permission'),
      decision: z.enum(['once', 'session', 'deny']),
      user_note: z.string().optional(),
    }),
  ]),
});
export type VibeReplyBody = z.infer<typeof VibeReplyBodySchema>;

export const VibeReplyResponseSchema = z.object({
  ok: z.literal(true),
  accepted: z.literal(true),
});
export type VibeReplyResponse = z.infer<typeof VibeReplyResponseSchema>;

export const VibeReplyErrorSchema = z.object({
  ok: z.literal(false),
  error: z.enum([
    'session_not_found',
    'session_not_blocking',
    'prompt_id_mismatch',
    'prompt_expired',
    'invalid_answer_kind',
    'invalid_body',
  ]),
  expected_prompt_id: z.string().optional(),
});
export type VibeReplyError = z.infer<typeof VibeReplyErrorSchema>;

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

/* ── v2.3: dashboard CLI parity panels ──────────────────────────────────
 *
 * Five new GET endpoints surface the CLI's `config show`, `doctor`,
 * `detect-phase`, `update --json`, and `help` registry data inside the
 * dashboard. Schemas live here so server and client share one wire
 * contract; concrete inner shapes (e.g. `SwtConfig`, `PhaseDetectResult`)
 * stay typed in their owning packages (`@swt-labs/core`,
 * `@swt-labs/methodology`) and ride through these envelopes as
 * `z.unknown()` to keep `dashboard-core` decoupled from those packages.
 *
 * Phase 1 of v2.3 ships the routes only — read-only, pull-on-demand, no
 * SSE event types. Phase 3 adds writable counterparts (`POST /api/config`,
 * `POST /api/update/apply`).
 */

export const ConfigSnapshotSchema = z.object({
  /**
   * False when the daemon found no `.swt-planning/config.json`. The
   * embedded `config` falls back to `DEFAULT_CONFIG` from `@swt-labs/core`
   * so the dashboard can still render fields against the schema.
   */
  is_initialized: z.boolean(),
  /**
   * Concrete shape is `SwtConfig` from `@swt-labs/core`. Kept as
   * `z.unknown()` here to avoid cross-package coupling — clients import
   * `SwtConfig` directly from `@swt-labs/core` and assert on this field.
   */
  config: z.unknown(),
  source: z.enum(['file', 'default']),
  generated_at: z.string().datetime({ offset: true }),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

export const DoctorCheckSchema = z.object({
  /** Stable id for client-side keying; e.g. 'node-version'. */
  id: z.string().min(1),
  /** Human-readable check name; e.g. 'Node ≥ 20'. */
  name: z.string().min(1),
  status: z.enum(['pass', 'fail', 'warn']),
  /** One-line freeform detail; the panel surfaces this verbatim. */
  detail: z.string(),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DoctorReportSchema = z.object({
  checks: z.array(DoctorCheckSchema),
  /** `pass` only when every check passes; `fail` if any fails; else `warn`. */
  overall_status: z.enum(['pass', 'fail', 'warn']),
  generated_at: z.string().datetime({ offset: true }),
});
export type DoctorReport = z.infer<typeof DoctorReportSchema>;

export const DetectPhaseReportSchema = z.object({
  /**
   * Concrete shape is `PhaseDetectResult` from `@swt-labs/methodology`.
   * Kept as `z.unknown()` here for the same decoupling reason as
   * `ConfigSnapshot.config`.
   */
  result: z.unknown(),
  is_initialized: z.boolean(),
  generated_at: z.string().datetime({ offset: true }),
});
export type DetectPhaseReport = z.infer<typeof DetectPhaseReportSchema>;

export const UpdateReportSchema = z.object({
  current_version: z.string().min(1),
  /** Null when the registry was unreachable. Always-present when reachable. */
  latest_version: z.string().nullable(),
  update_available: z.boolean(),
  /** v2.3 ships npm only. Marketplace dispatch lands in a future milestone. */
  registry: z.literal('npm'),
  last_checked: z.string().datetime({ offset: true }),
  /** Null on success; non-null when `latest_version: null` to explain why. */
  error: z.string().nullable(),
});
export type UpdateReport = z.infer<typeof UpdateReportSchema>;

export const CommandSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Argv usage suffix from the CLI registry; null when verb takes none. */
  usage: z.string().nullable(),
  /**
   * - `core` — verb has a real CLI handler (config / doctor / detect-phase / etc).
   * - `stub` — verb is a roadmap placeholder (init / plan / execute / etc).
   * - `interactive` — verb requires a TTY (vibe / watch / dashboard).
   */
  category: z.enum(['core', 'stub', 'interactive']),
  /**
   * True when the verb can run from the dashboard's `POST /api/command`
   * route without blocking on stdin or recursing the daemon. Mirrors the
   * server-side `ALLOWED_NON_INTERACTIVE_VERBS` set.
   */
  dashboard_safe: z.boolean(),
});
export type CommandSpec = z.infer<typeof CommandSpecSchema>;

export const CommandRegistrySchema = z.object({
  verbs: z.array(CommandSpecSchema),
  generated_at: z.string().datetime({ offset: true }),
});
export type CommandRegistry = z.infer<typeof CommandRegistrySchema>;

/* ── v2.3 Phase 03: mutation routes ─────────────────────────────────── */

/**
 * `POST /api/config` body. The inner `config` carries the new SwtConfig
 * shape; kept as `z.unknown()` here so dashboard-core stays decoupled
 * from `@swt-labs/core`. The server validates via `parseConfig` after
 * this layer's structural check.
 */
export const ConfigUpdateBodySchema = z
  .object({
    config: z.unknown(),
  })
  .strict();
export type ConfigUpdateBody = z.infer<typeof ConfigUpdateBodySchema>;

export const ConfigUpdateResponseSchema = z.object({
  ok: z.literal(true),
  config: z.unknown(),
  generated_at: z.string().datetime({ offset: true }),
});
export type ConfigUpdateResponse = z.infer<typeof ConfigUpdateResponseSchema>;

/**
 * `POST /api/update/apply` response. Daemon attempts `npm i -g
 * stop-wasting-tokens@latest`; on EACCES/EPERM the response carries
 * `requires_elevation: true` + a `copyable_command` the panel can
 * surface for the user to run via sudo.
 */
export const UpdateApplyResponseSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  requires_elevation: z.boolean(),
  /** Null when `requires_elevation` is false. */
  copyable_command: z.string().nullable(),
});
export type UpdateApplyResponse = z.infer<typeof UpdateApplyResponseSchema>;

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
  '/api/vibe': {
    method: 'POST',
    body: VibeStartBodySchema,
    response: VibeStartResponseSchema,
  },
  '/api/vibe/:session_id/reply': {
    method: 'POST',
    body: VibeReplyBodySchema,
    response: VibeReplyResponseSchema,
  },
  '/api/config': {
    method: 'GET',
    response: ConfigSnapshotSchema,
  },
  '/api/doctor': {
    method: 'GET',
    response: DoctorReportSchema,
  },
  '/api/detect-phase': {
    method: 'GET',
    response: DetectPhaseReportSchema,
  },
  '/api/update': {
    method: 'GET',
    response: UpdateReportSchema,
  },
  '/api/commands': {
    method: 'GET',
    response: CommandRegistrySchema,
  },
  '/api/config:POST': {
    method: 'POST',
    body: ConfigUpdateBodySchema,
    response: ConfigUpdateResponseSchema,
  },
  '/api/update/apply': {
    method: 'POST',
    response: UpdateApplyResponseSchema,
  },
} as const;
export type ApiSchemaMap = typeof ApiSchemas;
