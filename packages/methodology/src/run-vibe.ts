import type { HarvestStrategy } from '@swt-labs/orchestration';
import type { MeterContext, MeterSnapshot, TokenMeter } from '@swt-labs/shared';

export interface RunVibeOptions {
  readonly cwd: string;
  readonly meter?: TokenMeter;
  readonly meterContext?: MeterContext;
  readonly harvestStrategy?: HarvestStrategy;
  readonly phase?: string;
  readonly slug?: string;
}

export interface RunVibeResult {
  readonly artefactsPath: string;
  readonly finalState: 'execute-complete';
  readonly meterSnapshot: MeterSnapshot;
  readonly criteriaSatisfied: number;
}

/**
 * Deferred stub. The prior alpha's Execute-mode driver
 * (vibe/handlers/execute.ts) was deleted per TDD3 §23.6 and replaced by the
 * `swt cook` orchestrator (TypeScript handler at
 * packages/cli/src/commands/cook.ts, CLI verb registered in
 * packages/cli/src/main.ts).
 *
 * Consumers (test-utils' runMilestone, swt bench) currently compile against
 * this stub and throw at runtime. The intended migration path is to invoke
 * the cook handler directly via the CommandRegistry rather than calling
 * runVibe(); the deeper caller migration is deferred (see plan 03-04 T3).
 */
export function runVibe(_opts: RunVibeOptions): Promise<RunVibeResult> {
  return Promise.reject(
    new Error(
      'runVibe() is a deferred stub. Use `swt cook` (CLI verb registered in packages/cli/src/main.ts → packages/cli/src/commands/cook.ts) for the orchestrator entry point. `swt bench` and runMilestone test utils should invoke the cook handler directly via the CommandRegistry rather than calling runVibe().',
    ),
  );
}
