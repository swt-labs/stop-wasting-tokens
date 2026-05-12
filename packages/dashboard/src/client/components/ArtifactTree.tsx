import type { ArtifactKind, PhaseSummary } from '@swt-labs/shared';
import { For, Show, createSignal, type Component } from 'solid-js';

const KIND_CLASS: Record<ArtifactKind, string> = {
  research: 'artifact-research',
  plan: 'artifact-plan',
  summary: 'artifact-summary',
  verification: 'artifact-verification',
  uat: 'artifact-uat',
  context: 'artifact-context',
};

const KIND_BADGE: Record<ArtifactKind, string> = {
  research: 'R',
  plan: 'P',
  summary: 'S',
  verification: 'V',
  uat: 'U',
  context: 'C',
};

export interface ArtifactTreeProps {
  phases: readonly PhaseSummary[];
  selected: { phase: string; name: string } | null;
  onSelect: (phase: string, artifactName: string) => void;
}

export const ArtifactTree: Component<ArtifactTreeProps> = (props) => {
  return (
    <nav class="artifact-tree" role="tree" aria-label="Artifacts">
      <h2 class="panel-header">Artifacts</h2>
      <For each={props.phases}>{(phase) => <PhaseNode phase={phase} {...props} />}</For>
    </nav>
  );
};

interface PhaseNodeProps {
  phase: PhaseSummary;
  selected: { phase: string; name: string } | null;
  onSelect: (phase: string, artifactName: string) => void;
}

const PhaseNode: Component<PhaseNodeProps> = (props) => {
  const [expanded, setExpanded] = createSignal(true);
  const fileCount = (): number => props.phase.artifacts.length;
  return (
    <div class="artifact-tree-phase" role="treeitem" aria-expanded={expanded()}>
      <button
        type="button"
        class="artifact-tree-phase-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="artifact-tree-toggle">{expanded() ? '▾' : '▸'}</span>
        <span class="artifact-tree-phase-slug">{props.phase.slug}</span>
        <span class="artifact-tree-phase-count">({fileCount()})</span>
      </button>
      <Show when={expanded()}>
        <ul class="artifact-tree-files">
          <For each={props.phase.artifacts}>
            {(artifact) => {
              const kindClass = artifact.kind ? KIND_CLASS[artifact.kind] : 'artifact-other';
              const kindBadge = artifact.kind ? KIND_BADGE[artifact.kind] : '·';
              const isSelected = (): boolean =>
                props.selected?.phase === props.phase.slug &&
                props.selected?.name === artifact.name;
              return (
                <li class="artifact-tree-file" role="treeitem">
                  <button
                    type="button"
                    class={`artifact-tree-file-button ${kindClass}`}
                    data-selected={isSelected() ? 'true' : 'false'}
                    onClick={() => props.onSelect(props.phase.slug, artifact.name)}
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
    </div>
  );
};
