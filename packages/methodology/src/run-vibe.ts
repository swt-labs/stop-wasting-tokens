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
 * Deferred until TDD3 Phase A wires the new orchestrator. The prior alpha's
 * Execute-mode driver (vibe/handlers/execute.ts) was deleted per TDD3 §23.6.
 * The replacement is the script-driven orchestrator (commands/cook.md +
 * scripts/phase-detect.sh + scripts/suggest-next.sh) loaded from the SWT
 * install root.
 *
 * Consumers (test-utils' runMilestone, swt bench) compile against this stub
 * and throw at runtime until Phase A lands.
 */
export function runVibe(_opts: RunVibeOptions): Promise<RunVibeResult> {
  return Promise.reject(
    new Error(
      'runVibe is deferred until TDD3 Phase A wires the script-driven orchestrator. ' +
        'See commands/cook.md and TDD3 §18 Phase A for the replacement plan.',
    ),
  );
}
