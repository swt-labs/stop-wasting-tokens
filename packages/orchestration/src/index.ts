/**
 * Public surface for `@swt-labs/orchestration` — Layer 2.
 *
 * What's exported in PR-03 (Plan 01-01):
 *   - `createDispatcher` + types (`Dispatcher`, `TaskBrief`, `TaskResult`)
 *   - `PiSpawnerEnvironment` (consumed by `cli/main.ts` — swaps PR-02's MockSpawnerEnvironment)
 *
 * What lands later in this plan:
 *   - PR-04: type migration to `@swt-labs/shared`; orchestration re-exports
 *     `Dispatcher` / `TaskBrief` / `TaskResult` from there.
 * What lands in Plan 01-02:
 *   - PR-09: `result-harvest.ts` — reads `swt_report_result` entries from Pi
 *     session files and validates against `TaskResultSchema`.
 * What lands in M3:
 *   - PR-22..PR-29: `worktree-manager`, `claim-registry`, `dag-resolver`,
 *     `lock-files`. Parallel batches inside `dispatchBatch`.
 *
 * Per Principle 2 (TDD2 §4.3): orchestration may depend on runtime, core,
 * and shared (when shared lands). It must NOT depend on cli or dashboard.
 */

export {
  createDispatcher,
  type SessionFactory,
  type HarvestStrategy,
  type CreateDispatcherOptions,
} from './dispatcher.js';
export { PiSpawnerEnvironment } from './PiSpawnerEnvironment.js';
export type { Dispatcher, TaskBrief, TaskResult } from './types.js';

// PR-09 (Plan 01-02): result harvest from Pi session entries.
// Per ADR-002 — the dispatched agent calls `swt_report_result` (registered
// by `runtime/extensions/result-protocol.ts`); the harvester reads the
// `custom` entry it persists via closure-captured `pi.appendEntry`.
export {
  harvestTaskResult,
  harvestTaskResultFromEntries,
  readSessionEntries,
  MissingTaskResultError,
  type PiSessionEntryLike,
} from './result-harvest.js';

// PR-12 (M2): role-router + prompt-builder. Per TDD2 §10.4 + §8.3.
export { toolsForRole, ROLE_TOOL_SUBSETS, type AgentToolList } from './role-router.js';
export {
  buildPrompt,
  readRolePrompt,
  type BuildPromptOptions,
  type BuiltPrompt,
  type PromptBlock,
} from './prompt-builder.js';

// PR-19 (M2): TPAC aggregator. Per TDD2 §8.1. Reduces a MeterSnapshot
// into a milestone-scoped TpacReport for `swt bench` (PR-21) emit + the
// dashboard Milestones panel + the M4 PR-32 −40% target check.
export {
  computeTpac,
  summariseRoles,
  NoSatisfiedCriteriaError,
  type ComputeTpacOptions,
  type RoleSummary,
} from './tpac-meter.js';
