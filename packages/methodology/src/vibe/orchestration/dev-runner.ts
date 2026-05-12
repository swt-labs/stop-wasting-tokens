/**
 * Dev runner — sequential per-plan dispatch through `@swt-labs/orchestration`'s
 * dispatcher, replacing the v2 `AgentSpawner`-driven path. Per the M2 PR-13
 * mandate (Plan 02-01) + TDD2 §11.4:
 *
 *   - One `dispatcher.dispatch({ role: 'dev', ... })` call per plan.
 *   - Sequential at M2 (no worktree isolation); M3 PR-22..24 parallelise via
 *     worktree-keyed claims without reshaping this surface.
 *   - Halt-on-failed: a `failed` or `blocked` `TaskResult.status` stops the
 *     loop so QA/Debugger can take over downstream (handled by the methodology
 *     FSM in M2 PR-15's `re-verify.ts` rewire).
 *   - The dispatcher's `'entries'` HarvestStrategy is the production path —
 *     the dev session emits a `swt-task-result` custom entry via the runtime
 *     Extension (Plan 01-02 PR-09 + ADR-002), the harvester validates against
 *     `TaskResultSchema`. The dispatcher's defensive task_id mismatch guard
 *     catches stale entries (added in PR-13).
 *   - The legacy `'stub'` strategy stays the default so tests that don't wire
 *     a real session don't need synthetic entry plumbing.
 */
import { createDispatcher, type HarvestStrategy } from '@swt-labs/orchestration';
import type { MeterContext, TaskResult, TokenMeter } from '@swt-labs/shared';

import type { PlanRecord } from './waves.js';

export interface DevRunnerOptions {
  /**
   * Passed straight to `createDispatcher`. Defaults to `'stub'` so callers
   * without a real Pi session (or the entries getter from one) still get a
   * synthetic success per `TaskResultSchema`. Production callers should wire
   * `{ kind: 'entries', getEntries }` against the active session's entry list.
   */
  readonly harvestStrategy?: HarvestStrategy;
  /**
   * Optional TokenMeter forwarded to the dispatcher so real Pi sessions
   * route `TASK_TOKEN_USAGE` records into the supplied meter (PR-T).
   */
  readonly meter?: TokenMeter;
  /**
   * Per-session meter dimensions. The dev-runner already knows the
   * milestone + phase (from `DevRunInput`); callers can layer milestone
   * + role + tier on top via this field.
   */
  readonly meterContext?: MeterContext;
}

export interface DevTaskOutcome {
  readonly plan: PlanRecord;
  readonly result: TaskResult;
}

export interface DevRunSummary {
  readonly outcomes: ReadonlyArray<DevTaskOutcome>;
  readonly status: 'success' | 'halted';
  readonly haltReason?: string;
}

export interface DevRunInput {
  readonly phase: string;
  readonly plans: ReadonlyArray<PlanRecord>;
  readonly cwd: string;
  readonly opts?: DevRunnerOptions;
}

export async function runDevTasks(input: DevRunInput): Promise<DevRunSummary> {
  const opts = input.opts;
  const meter = opts?.meter;
  const meterContext: MeterContext = {
    phase: input.phase,
    role: 'dev',
    ...(opts?.meterContext ?? {}),
  };
  const dispatcher = createDispatcher({
    harvestStrategy: opts?.harvestStrategy ?? 'stub',
    ...(meter !== undefined ? { meter } : {}),
    meterContext,
  });
  const outcomes: DevTaskOutcome[] = [];
  for (const plan of input.plans) {
    const taskId = buildTaskId(input.phase, plan.plan);
    const result = await dispatcher.dispatch({
      taskId,
      role: 'dev',
      cwd: input.cwd,
      claims: plan.files_modified,
      promptContext: {
        phase: input.phase,
        plan: plan.plan,
        title: plan.title,
        wave: plan.wave,
        depends_on: plan.depends_on,
      },
    });
    outcomes.push({ plan, result });
    if (result.status === 'failed' || result.status === 'blocked') {
      return {
        outcomes,
        status: 'halted',
        haltReason: `plan ${plan.plan} returned status=${result.status}: ${result.summary}`,
      };
    }
  }
  return { outcomes, status: 'success' };
}

/**
 * Compose the task_id the dispatcher harvests against. The format
 * `{phase}-{plan}-dev` keeps it unique within a milestone and trivially
 * round-trips through the dispatcher's defensive task_id-mismatch guard.
 */
export function buildTaskId(phase: string, plan: string): string {
  return `${phase}-${plan}-dev`;
}
