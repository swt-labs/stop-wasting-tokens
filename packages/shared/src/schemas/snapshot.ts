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

export const PlanSummarySchema = z.object({
  plan: z.string().min(1),
  title: z.string().min(1),
  wave: z.number().int().nonnegative().optional(),
  status: z.enum(['pending', 'in_progress', 'complete', 'failed']).optional(),
  artifacts: z.array(ArtifactSummarySchema).optional(),
});
export type PlanSummary = z.infer<typeof PlanSummarySchema>;

export const PhaseSummarySchema = z.object({
  position: z.string().regex(/^\d{2}$/, 'position must be zero-padded two-digit string'),
  slug: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().optional(),
  state: PhaseStateSchema,
  qa_status: QaStatusSchema,
  artifacts: z.array(ArtifactSummarySchema),
  /**
   * Plan 04-02 T1 (REQ-07 Pane 2 drill-in) — per-phase plan summaries derived
   * from PLAN.md frontmatter under each phase directory. Optional for
   * back-compat with snapshots emitted before this field landed; client
   * renderers should default to an empty array.
   */
  plans: z.array(PlanSummarySchema).optional(),
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

/**
 * Plan 04-02 T1 (REQ-07 Pane 1) — optional codebase profile read from
 * PROJECT.md / STATE.md by the reducer. All fields optional so the dashboard
 * gracefully degrades when the markdown body omits them.
 */
export const CodebaseProfileSchema = z.object({
  stack: z.string().optional(),
  languages: z.array(z.string()).optional(),
  loc: z.number().int().nonnegative().optional(),
});
export type CodebaseProfile = z.infer<typeof CodebaseProfileSchema>;

export const ProjectSummarySchema = z.object({
  name: z.string().min(1),
  root: z.string().min(1),
  backend: BackendSchema,
  description: z.string().optional(),
  codebase_profile: CodebaseProfileSchema.optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const MilestoneTodoSchema = z.object({
  text: z.string().min(1),
  phase: z.string().optional(),
});
export type MilestoneTodo = z.infer<typeof MilestoneTodoSchema>;

export const MilestoneSummarySchema = z.object({
  name: z.string().min(1),
  phase_count: z.number().int().nonnegative(),
  phase_index: z.number().int().min(1),
  /**
   * 0..1 derived from per-phase QA status — passed/remediated → +1, others
   * fractional. Optional so pre-04-02 snapshots still parse; the SPA defaults
   * to 0 when missing.
   */
  percent_complete: z.number().min(0).max(1).optional(),
  todos: z.array(MilestoneTodoSchema).optional(),
  blockers: z.array(MilestoneTodoSchema).optional(),
});
export type MilestoneSummary = z.infer<typeof MilestoneSummarySchema>;

/**
 * Plan 04-02 T1 (REQ-07 Pane 3) — per-agent live state. Replaces the previous
 * singular nullable field (one-active-agent assumption, now retired). Sourced
 * from `.swt-planning/.sessions/*.json` (Phase 2 agent-pid-tracker.sh) with
 * the latest cook event metadata folded in by the reducer.
 */
export const AgentLiveStateSchema = z.object({
  sub_session_id: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  status: z.enum(['idle', 'spawning', 'running', 'completed', 'failed']),
  current_tool: z.string().optional(),
  current_tool_input_excerpt: z.string().optional(),
  tokens_in: z.number().nonnegative(),
  tokens_out: z.number().nonnegative(),
  cache_read: z.number().nonnegative(),
  cache_creation: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
  started_at: z.string().datetime({ offset: true }),
  pid: z.number().int().optional(),
});
export type AgentLiveState = z.infer<typeof AgentLiveStateSchema>;

export const CostBudgetSchema = z.object({
  phase_limit_usd: z.number().nonnegative(),
  spent_pct: z.number().min(0),
});
export type CostBudget = z.infer<typeof CostBudgetSchema>;

export const CostTokensSchema = z.object({
  in: z.number().nonnegative(),
  out: z.number().nonnegative(),
  cache_creation: z.number().nonnegative(),
  cache_read: z.number().nonnegative(),
});
export type CostTokens = z.infer<typeof CostTokensSchema>;

export const CostSummarySchema = z.object({
  total_usd: z.number().nonnegative(),
  today_usd: z.number().nonnegative(),
  this_milestone_usd: z.number().nonnegative(),
  /**
   * Plan 04-02 T1 (REQ-07 Pane 4). Optional fields keep pre-04-02 snapshots
   * (and the legacy empty.ts shape) parseable; the renderer defaults to 0
   * when missing.
   */
  this_phase_usd: z.number().nonnegative().optional(),
  this_session_usd: z.number().nonnegative().optional(),
  cache_hit_ratio: z.number().min(0).max(1).optional(),
  tokens: CostTokensSchema.optional(),
  budget: CostBudgetSchema.optional(),
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
  /**
   * Plan 04-02 T1 (REQ-07 Pane 3) — array form replaces the previous nullable
   * singular field. The reducer always emits an array (possibly empty); the
   * SPA is responsible for rendering the "no agents running" state. The
   * `.default([])` shim keeps any in-flight pre-04-02 snapshot wire frames
   * parseable for one minor version (drop in v3.1).
   */
  active_agents: z.array(AgentLiveStateSchema).default([]),
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
