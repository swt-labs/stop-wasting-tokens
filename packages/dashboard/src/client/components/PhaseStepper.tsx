import type { PhaseState, PhaseSummary, PlanSummary } from '@swt-labs/shared';
import { For, Show, type Component } from 'solid-js';

const STATE_CLASS: Record<PhaseState, string> = {
  needs_discussion: 'phase-pending',
  needs_plan_and_execute: 'phase-pending',
  needs_execute: 'phase-active',
  needs_verification: 'phase-active',
  all_done: 'phase-done',
  needs_qa_remediation: 'phase-warn',
  needs_uat_remediation: 'phase-warn',
};

const STATE_LABEL: Record<PhaseState, string> = {
  needs_discussion: 'pending discussion',
  needs_plan_and_execute: 'pending plan + exec',
  needs_execute: 'in progress',
  needs_verification: 'in verification',
  all_done: 'done',
  needs_qa_remediation: 'qa remediation',
  needs_uat_remediation: 'uat remediation',
};

const PLAN_STATUS_ICON: Record<NonNullable<PlanSummary['status']>, string> = {
  pending: '○',
  in_progress: '◆',
  complete: '✓',
  failed: '✗',
};

/** Exported for unit testing — see `phase-stepper-helpers.test.ts`. */
export function planStatusIcon(status: PlanSummary['status']): string {
  return status === undefined ? '·' : PLAN_STATUS_ICON[status];
}

function defaultArtifactName(phase: PhaseSummary): string | null {
  // Prefer summary > plan > research > context
  const orderedKinds = ['summary', 'plan', 'research', 'context', 'verification', 'uat'] as const;
  for (const kind of orderedKinds) {
    const hit = phase.artifacts.find((a) => a.kind === kind);
    if (hit) return hit.name;
  }
  return phase.artifacts[0]?.name ?? null;
}

export interface PhaseStepperProps {
  phases: readonly PhaseSummary[];
  currentIndex: number;
  selectedPhase: string | null;
  onSelect: (phase: string, artifactName: string) => void;
}

export const PhaseStepper: Component<PhaseStepperProps> = (props) => {
  return (
    <nav class="phase-stepper" aria-label="Phases">
      <h2 class="panel-header">Phases</h2>
      <ol class="phase-stepper-list">
        <For each={props.phases}>
          {(phase) => {
            const isCurrent = (): boolean =>
              Number.parseInt(phase.position, 10) === props.currentIndex;
            const isSelected = (): boolean => props.selectedPhase === phase.slug;
            const handleClick = (): void => {
              const name = defaultArtifactName(phase);
              if (name) props.onSelect(phase.slug, name);
            };
            const plans = (): readonly PlanSummary[] => phase.plans ?? [];
            // Plan rows render under the selected (or current) phase only —
            // keeps the column compact while still surfacing the drill-in
            // (REQ-07 Pane 2).
            const showPlans = (): boolean => plans().length > 0 && (isSelected() || isCurrent());
            return (
              <li class="phase-stepper-item">
                <button
                  type="button"
                  class={`phase-stepper-button ${STATE_CLASS[phase.state]}`}
                  data-current={isCurrent() ? 'true' : 'false'}
                  data-selected={isSelected() ? 'true' : 'false'}
                  aria-current={isCurrent() ? 'step' : undefined}
                  aria-label={`Phase ${phase.position}, ${STATE_LABEL[phase.state]}`}
                  onClick={handleClick}
                >
                  <span class="phase-stepper-position">{phase.position}</span>
                  <span class="phase-stepper-name">{phase.name}</span>
                  <span class="phase-stepper-state">{STATE_LABEL[phase.state]}</span>
                </button>
                <Show when={showPlans()}>
                  <ul class="phase-stepper-plans">
                    <For each={plans()}>
                      {(plan) => (
                        <li class={`phase-stepper-plan plan-${plan.status ?? 'pending'}`}>
                          <span class="plan-id">
                            {phase.position}-{plan.plan}
                          </span>
                          <span class="plan-title">{plan.title}</span>
                          <span
                            class="plan-status"
                            aria-label={`Status: ${plan.status ?? 'pending'}`}
                          >
                            {planStatusIcon(plan.status)}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </li>
            );
          }}
        </For>
      </ol>
    </nav>
  );
};
