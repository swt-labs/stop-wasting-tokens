/**
 * Zod schemas — runtime validators for vendor-neutral envelopes shared across
 * runtime, orchestration, methodology, dashboard, and cli.
 *
 * Migrated in PR-04 from `dashboard-core/src/schemas/` (git mv preserved history):
 *   - snapshot.ts (project state snapshot the dashboard renders)
 *   - events.ts (SSE event payloads)
 *   - api.ts (dashboard HTTP API contracts, including DoctorReportSchema)
 * New in PR-04 (TDD2 §9.4):
 *   - task-result.ts (TaskResultSchema — the swt_report_result envelope)
 *   - plan.ts (PlanSchema — *-PLAN.md frontmatter validator)
 *   - claim.ts (ClaimSchema — file-claim registry envelope, used in M3)
 *   - budget.ts (BudgetConfigSchema + BudgetStateSchema, used in M4 Budget Gate)
 */

export * from './snapshot.js';
export * from './events.js';
export * from './api.js';
export * from './task-result.js';
export * from './plan.js';
export * from './claim.js';
export * from './budget.js';
export * from './tpac-report.js';
export * from './worktree-state.js';
export * from './lock-file.js';
export * from './todo.js';
