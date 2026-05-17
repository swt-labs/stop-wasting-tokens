/**
 * `PhaseCard` — one row of the merged PHASES card (the pre-merge
 * PHASES + ARTIFACTS split, collapsed into a single column).
 *
 * Shape per a_non_production_files/artifacts.md:
 *   header  → position · name · lifecycle state · file count · chevron
 *   body    → plan list (under selected/current phase) AND artifact
 *              file list (when expanded)
 *
 * Click semantics (design decision §1, locked): a click on the header
 * does BOTH — calls `onSelect(phaseSlug, artifactName)` AND toggles the
 * row's local `expanded` signal. Selection and expansion are coupled
 * into one gesture. When the phase has zero artifacts (design decision
 * §2), the chevron is rendered visibly-disabled (`aria-disabled="true"`,
 * grey class) and click still selects but does NOT toggle.
 *
 * Component structure (design decision §3): row-level state
 * (`expanded`) lives here, isolated from the parent list shell.
 * `PhaseStepper.tsx` is now a thin map-to-PhaseCard wrapper.
 *
 * Existing data attributes / aria semantics are preserved verbatim from
 * the pre-merge PhaseStepper button (`data-current`, `data-selected`,
 * `aria-current="step"`, `aria-label`) so the existing snapshot
 * `phase-stepper-button[data-current='true']` CSS rule and any
 * accessibility tests keep working.
 */

import type { PhaseState, PhaseSummary, PlanSummary } from '@swt-labs/shared';
import { For, Show, createSignal, type Component } from 'solid-js';

import {
  KIND_BADGE,
  KIND_CLASS,
  chevronGlyph,
  isArtifactSelected,
  isPhaseRowExpandable,
  phaseRowChevronClass,
} from './phase-card-helpers.js';
import { planStatusIcon } from './PhaseStepper.jsx';

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

function defaultArtifactName(phase: PhaseSummary): string | null {
  // Prefer summary > plan > research > context — same order PhaseStepper
  // used before the merge so click→select picks the most-useful artifact
  // when a row has multiple.
  const orderedKinds = ['summary', 'plan', 'research', 'context', 'verification', 'uat'] as const;
  for (const kind of orderedKinds) {
    const hit = phase.artifacts.find((a) => a.kind === kind);
    if (hit) return hit.name;
  }
  return phase.artifacts[0]?.name ?? null;
}

export interface PhaseCardProps {
  phase: PhaseSummary;
  currentIndex: number;
  selectedPhase: string | null;
  /** Currently selected artifact across the dashboard — used to apply
   *  the highlight on the matching file row inside the expanded body. */
  selectedArtifact: { phase: string; name: string } | null;
  onSelect: (phase: string, artifactName: string) => void;
}

export const PhaseCard: Component<PhaseCardProps> = (props) => {
  // Default expanded:true matches the pre-merge ArtifactTree's PhaseNode
  // default — users coming from v7 storage see no behaviour change.
  const [expanded, setExpanded] = createSignal(true);

  const isCurrent = (): boolean => Number.parseInt(props.phase.position, 10) === props.currentIndex;
  const isSelected = (): boolean => props.selectedPhase === props.phase.slug;
  const plans = (): readonly PlanSummary[] => props.phase.plans ?? [];
  // Plan rows still render under the selected (or current) phase only —
  // keeps the column compact (REQ-07 Pane 2, preserved across the merge).
  const showPlans = (): boolean => plans().length > 0 && (isSelected() || isCurrent());
  const expandable = (): boolean => isPhaseRowExpandable(props.phase);

  const handleClick = (): void => {
    const name = defaultArtifactName(props.phase);
    if (name) props.onSelect(props.phase.slug, name);
    // Click toggles expansion only when the row has artifacts; empty
    // rows still select but the chevron is a no-op (design decision §2).
    if (expandable()) setExpanded((v) => !v);
  };

  return (
    <li class="phase-stepper-item">
      <button
        type="button"
        class={`phase-stepper-button ${STATE_CLASS[props.phase.state]}`}
        data-current={isCurrent() ? 'true' : 'false'}
        data-selected={isSelected() ? 'true' : 'false'}
        aria-current={isCurrent() ? 'step' : undefined}
        aria-expanded={expandable() ? expanded() : undefined}
        aria-label={`Phase ${props.phase.position}, ${STATE_LABEL[props.phase.state]}`}
        onClick={handleClick}
      >
        <span class="phase-stepper-position">{props.phase.position}</span>
        <span class="phase-stepper-name">{props.phase.name}</span>
        <span class="phase-stepper-state">{STATE_LABEL[props.phase.state]}</span>
        <span class="phase-card-count">({props.phase.artifacts.length})</span>
        <span
          class={phaseRowChevronClass(expandable())}
          aria-disabled={expandable() ? undefined : 'true'}
          aria-hidden="true"
        >
          {chevronGlyph(expanded(), expandable())}
        </span>
      </button>
      <Show when={showPlans()}>
        <ul class="phase-stepper-plans">
          <For each={plans()}>
            {(plan) => (
              <li class={`phase-stepper-plan plan-${plan.status ?? 'pending'}`}>
                <span class="plan-id">
                  {props.phase.position}-{plan.plan}
                </span>
                <span class="plan-title">{plan.title}</span>
                <span class="plan-status" aria-label={`Status: ${plan.status ?? 'pending'}`}>
                  {planStatusIcon(plan.status)}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={expandable() && expanded()}>
        <ul class="artifact-tree-files">
          <For each={props.phase.artifacts}>
            {(artifact) => {
              const kindClass = artifact.kind ? KIND_CLASS[artifact.kind] : 'artifact-other';
              const kindBadge = artifact.kind ? KIND_BADGE[artifact.kind] : '·';
              const selected = (): boolean =>
                isArtifactSelected(props.selectedArtifact, props.phase.slug, artifact.name);
              return (
                <li class="artifact-tree-file">
                  <button
                    type="button"
                    class={`artifact-tree-file-button ${kindClass}`}
                    data-selected={selected() ? 'true' : 'false'}
                    onClick={(event) => {
                      // Prevent the row-header click from also firing,
                      // which would re-toggle the row when the user is
                      // really just picking a file inside the expanded
                      // body.
                      event.stopPropagation();
                      props.onSelect(props.phase.slug, artifact.name);
                    }}
                  >
                    <span class="artifact-tree-kind-badge">{kindBadge}</span>
                    <span class="artifact-tree-name">{artifact.name}</span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </li>
  );
};
