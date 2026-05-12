import { z } from 'zod';

export const PhaseStateSchema = z.enum([
  'needs_discussion',
  'needs_plan_and_execute',
  'needs_execute',
  'needs_verification',
  'all_done',
  'needs_qa_remediation',
  'needs_uat_remediation',
]);
export type PhaseState = z.infer<typeof PhaseStateSchema>;

export const QaStatusSchema = z.enum(['none', 'pending', 'passed', 'failed', 'remediated']);
export type QaStatus = z.infer<typeof QaStatusSchema>;

export const ArtifactKindSchema = z.enum([
  'research',
  'plan',
  'summary',
  'verification',
  'uat',
  'context',
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactStatusSchema = z.enum(['present', 'missing', 'stale']);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const ArtifactSummarySchema = z.object({
  name: z.string().min(1),
  kind: ArtifactKindSchema,
  size_bytes: z.number().int().nonnegative(),
  mtime: z.string().datetime({ offset: true }),
  status: ArtifactStatusSchema.optional(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const PhaseSummarySchema = z.object({
  position: z.string().regex(/^\d{2}$/, 'position must be zero-padded two-digit string'),
  slug: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().optional(),
  state: PhaseStateSchema,
  qa_status: QaStatusSchema,
  artifacts: z.array(ArtifactSummarySchema),
});
export type PhaseSummary = z.infer<typeof PhaseSummarySchema>;

/**
 * Runtime backend identifier. v3 ships with Pi as the sole backend
 * (see ADR-001 + ADR-005). The legacy v2 enum (`codex`, `claude-code`,
 * `ollama`) was retired at M6 PR-45 — the three driver packages were
 * deleted at M1 PR-05 per ADR-005, and the schema now reflects v3
 * reality. Old snapshot files from v2 must be migrated via
 * `swt migrate --to=v3` (M6 PR-49) before loading.
 */
export const BackendSchema = z.enum(['pi']);
export type Backend = z.infer<typeof BackendSchema>;

export const ProjectSummarySchema = z.object({
  name: z.string().min(1),
  root: z.string().min(1),
  backend: BackendSchema,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const MilestoneSummarySchema = z.object({
  name: z.string().min(1),
  phase_count: z.number().int().nonnegative(),
  phase_index: z.number().int().min(1),
});
export type MilestoneSummary = z.infer<typeof MilestoneSummarySchema>;

export const ActiveAgentSchema = z.object({
  role: z.string().min(1),
  started_at: z.string().datetime({ offset: true }),
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().nullable(),
});
export type ActiveAgent = z.infer<typeof ActiveAgentSchema>;

export const CostSummarySchema = z.object({
  total_usd: z.number().nonnegative(),
  today_usd: z.number().nonnegative(),
  this_milestone_usd: z.number().nonnegative(),
});
export type CostSummary = z.infer<typeof CostSummarySchema>;

export const SnapshotSchema = z.object({
  schema_version: z.literal('1'),
  generated_at: z.string().datetime({ offset: true }),
  // Greenfield (no `.swt-planning/` yet) returns null for project, milestone,
  // and cost_summary so the SPA can branch on `is_initialized: false` and
  // render the InitScreen instead of the 4-panel grid.
  project: ProjectSummarySchema.nullable(),
  milestone: MilestoneSummarySchema.nullable(),
  phases: z.array(PhaseSummarySchema),
  active_agent: ActiveAgentSchema.nullable(),
  recent_events: z.array(z.unknown()).max(100),
  cost_summary: CostSummarySchema.nullable(),
  /**
   * False when the daemon's cwd has no `.swt-planning/` yet. The SPA uses
   * this to render the init flow. Required since v1.7.0 — every emitter
   * (reducer.ts, empty.ts) sets it explicitly, and the SSE layer is
   * session-local so back-compat with pre-v1.6.6 wire snapshots is moot.
   * The .default(true) shim was a v1.6.6 protective measure that's no
   * longer load-bearing.
   */
  is_initialized: z.boolean(),
  /**
   * True when the daemon's cwd has source files / a project structure but
   * no `.swt-planning/` yet (e.g., user ran `swt` inside an existing repo
   * that's never been touched by SWT). Lets the SPA show a brownfield-
   * aware InitScreen instead of the pure-greenfield "name a fresh project"
   * variant. Optional for back-compat with v2.1.x daemons that don't emit
   * it; clients should default to false.
   */
  brownfield_detected: z.boolean().optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
