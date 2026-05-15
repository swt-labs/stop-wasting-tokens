/**
 * Phase 04 — pure derivation helpers for the cook-bar's workflow state.
 *
 * Lives in `lib/` (NOT `App.tsx`) so the vitest node-environment can
 * import these functions without dragging in JSX-laden Solid components
 * (App.tsx pulls @corvu/resizable, which is client-only). App.tsx
 * re-exports `WorkflowState` + the two helpers so downstream consumers
 * (TopBar's type-only import, prod call sites) keep their existing
 * import path.
 */

import type { PhaseState } from '@swt-labs/shared';

/**
 * Phase 04 — the workflow-state vocabulary for the cook-bar placeholder
 * + hint. Derived from existing store fields by `deriveWorkflowState`;
 * the App passes the current value as a required prop on <TopBar>. The
 * full 5-state derivation matrix lives in 04-01-PLAN.md. The 6th
 * candidate `cook_crashed` is intentionally absent — the VibeCard
 * lifecycle pill + cook.error toast already surface that signal; see
 * the plan's Locked Decision #1.
 */
export type WorkflowState =
  | 'greenfield'
  | 'scoped_unplanned'
  | 'planned_unexecuted'
  | 'cook_running'
  | 'all_done';

/**
 * Pure derivation from the live store fields. Exported so the greenfield
 * smoke test (e2e-greenfield-smoke.test.ts) can assert against it
 * directly without rendering the App. NEVER mutates inputs; always
 * returns one of the five string literals.
 *
 * Precedence (top wins):
 *   1. `is_initialized === false`          → 'greenfield'
 *   2. `vibeSessionStatus === 'running'`   → 'cook_running'  (overrides static
 *                                            phase state while cook is live)
 *   3. all phases.state === 'all_done'     → 'all_done'      (only when
 *                                            phase_count > 0)
 *   4. first non-done phase is needs_discussion or
 *      needs_plan_and_execute              → 'scoped_unplanned'
 *   5. first non-done phase is needs_execute, needs_verification,
 *      needs_qa_remediation, or needs_uat_remediation
 *                                          → 'planned_unexecuted'
 *   6. otherwise (degenerate: initialized but phase_count === 0)
 *                                          → 'scoped_unplanned'  (defensive
 *                                            fallback; the dashboard should
 *                                            never sit here for long — Scope
 *                                            writes phases atomically)
 */
export function deriveWorkflowState(args: {
  isInitialized: boolean;
  phaseCount: number;
  phases: ReadonlyArray<{ state: PhaseState; position: string }>;
  vibeSessionStatus: 'running' | 'completed' | 'crashed' | undefined;
}): WorkflowState {
  if (!args.isInitialized) return 'greenfield';
  if (args.vibeSessionStatus === 'running') return 'cook_running';

  // Find the first phase that is NOT all_done. The phases array is
  // ordered by `position` from the snapshotter; phases[0] is the
  // current/next phase in execution order.
  const current = args.phases.find((p) => p.state !== 'all_done');

  if (!current) {
    // Every phase is all_done — milestone complete. Guard on
    // phase_count > 0 so a degenerate "0 phases" greenfield doesn't
    // falsely register as all_done.
    return args.phaseCount > 0 ? 'all_done' : 'scoped_unplanned';
  }

  const s = current.state;
  if (s === 'needs_discussion' || s === 'needs_plan_and_execute') {
    return 'scoped_unplanned';
  }
  // needs_execute, needs_verification, needs_qa_remediation,
  // needs_uat_remediation — all surface as "press Enter to execute"
  // because the next user action is Execute (or Verify, which routes
  // through the same Enter affordance).
  return 'planned_unexecuted';
}

/**
 * Phase 04 — return the two-digit `position` of the first phase whose
 * state is not 'all_done', or null if no such phase exists. Used by
 * TopBar's hint string to interpolate `↵ plan phase {NN}` /
 * `↵ execute phase {NN}`. Pure; exported for smoke-test assertions.
 */
export function firstActivePhasePosition(
  phases: ReadonlyArray<{ state: PhaseState; position: string }>,
): string | null {
  return phases.find((p) => p.state !== 'all_done')?.position ?? null;
}
