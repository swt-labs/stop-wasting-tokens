/**
 * Pure helpers for `PhaseCard.tsx` — the merged PHASES + ARTIFACTS row
 * component. Extracted into a separate module so node-env vitest can
 * exercise them without importing Solid or DOM (same pattern as
 * `askuser-card-helpers.ts` and `unified-log-helpers.ts`).
 *
 * No imports from `solid-js`, no `document`, no `fetch`. Everything here
 * is structural: given inputs, return classification / glyph / class
 * string / boolean. Component wiring lives in `PhaseCard.tsx`.
 */

import type { ArtifactKind, PhaseSummary } from '@swt-labs/shared';

/**
 * Kind → CSS class used to colour the artifact badge. Mirrors the
 * `artifact-{kind}` classes already defined in `styles.css`. Lifted out
 * of the deleted `ArtifactTree.tsx` so the rendering surface is shared
 * with PhaseCard (and re-usable by future single-phase views).
 */
export const KIND_CLASS: Record<ArtifactKind, string> = {
  research: 'artifact-research',
  plan: 'artifact-plan',
  summary: 'artifact-summary',
  verification: 'artifact-verification',
  uat: 'artifact-uat',
  context: 'artifact-context',
};

/**
 * Kind → single-character badge shown beside the artifact filename.
 * Mirrors the pre-merge ArtifactTree's `KIND_BADGE` exactly so the
 * visual artifact identity (R/P/S/V/U/C) survives the refactor.
 */
export const KIND_BADGE: Record<ArtifactKind, string> = {
  research: 'R',
  plan: 'P',
  summary: 'S',
  verification: 'V',
  uat: 'U',
  context: 'C',
};

/**
 * A phase row is expandable when it has at least one artifact. Empty
 * rows render the chevron as visibly-disabled (per the artifacts.md
 * design decision §3) — clicks still select the phase but expansion is
 * a no-op.
 */
export function isPhaseRowExpandable(phase: Pick<PhaseSummary, 'artifacts'>): boolean {
  return phase.artifacts.length > 0;
}

/**
 * Resolve the chevron glyph for a phase row.
 *
 * - Expandable + expanded → `▾`
 * - Expandable + collapsed → `▸`
 * - Non-expandable → `▸` (still rendered; visually disabled via class)
 */
export function chevronGlyph(expanded: boolean, expandable: boolean): string {
  if (!expandable) return '▸';
  return expanded ? '▾' : '▸';
}

/**
 * CSS classes for the chevron span. Always includes the base
 * `phase-card-toggle` class; appends `phase-card-toggle-disabled` when
 * the row has no artifacts so styling can grey it out and disable
 * pointer interaction.
 */
export function phaseRowChevronClass(expandable: boolean): string {
  return expandable ? 'phase-card-toggle' : 'phase-card-toggle phase-card-toggle-disabled';
}

/**
 * Returns true when the given (phase, artifact-name) pair matches the
 * currently selected artifact in the dashboard store. Used to apply the
 * `data-selected="true"` highlight inside the expanded artifact list.
 */
export function isArtifactSelected(
  selectedArtifact: { phase: string; name: string } | null,
  phaseSlug: string,
  artifactName: string,
): boolean {
  if (!selectedArtifact) return false;
  return selectedArtifact.phase === phaseSlug && selectedArtifact.name === artifactName;
}
