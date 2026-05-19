/**
 * `PhaseStepper` — thin list shell mapping phases → `PhaseCard`.
 *
 * The pre-merge component did everything: state-class lookup, plan-row
 * rendering, click→select. With the PHASES + ARTIFACTS panes merged
 * (see a_non_production_files/artifacts.md design decision §3), the
 * per-row JSX moved into `PhaseCard.tsx`. PhaseStepper is now just the
 * `<nav>` + `<ol>` + map.
 *
 * `planStatusIcon` stays exported here so existing tests
 * (`phase-stepper-helpers.test.ts`) keep working without import edits.
 * `PhaseCard.tsx` consumes it through the same import.
 */

import type { PhaseSummary, PlanSummary } from '@swt-labs/shared';
import { For, type Component } from 'solid-js';

import { PhaseCard } from './PhaseCard.jsx';

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

export interface PhaseStepperProps {
  phases: readonly PhaseSummary[];
  currentIndex: number;
  selectedPhase: string | null;
  /** The dashboard-wide selected artifact. Used by PhaseCard to apply
   *  the file-row highlight inside its expanded body. Pre-merge this
   *  was passed only to the now-deleted ArtifactTree. */
  selectedArtifact: { phase: string; name: string } | null;
  onSelect: (phase: string, artifactName: string) => void;
}

export const PhaseStepper: Component<PhaseStepperProps> = (props) => {
  return (
    <nav class="phase-stepper" aria-label="Phases">
      {/* Title moved to App.tsx panel chrome so the empty-state fallback
          (rendered when phases.length === 0) also shows a card title.
          PhaseStepper now renders only the list — App owns the header. */}
      <ol class="phase-stepper-list">
        <For each={props.phases}>
          {(phase) => (
            <PhaseCard
              phase={phase}
              currentIndex={props.currentIndex}
              selectedPhase={props.selectedPhase}
              selectedArtifact={props.selectedArtifact}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </ol>
    </nav>
  );
};
