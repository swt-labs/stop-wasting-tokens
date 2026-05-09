import { Show, createMemo, onCleanup, onMount, type Component } from 'solid-js';

import { AgentTimeline } from './components/AgentTimeline.js';
import { ArtifactPreview } from './components/ArtifactPreview.js';
import { ArtifactTree } from './components/ArtifactTree.js';
import { CostPanel } from './components/CostPanel.js';
import { InitScreen } from './components/InitScreen.js';
import { LogPanel } from './components/LogPanel.js';
import { PhaseStepper } from './components/PhaseStepper.js';
import { TopBar } from './components/TopBar.js';
import { UatModal } from './components/UatModal.js';
import { createDashboardStore } from './state/dashboard-store.js';

export const App: Component = () => {
  const [state, actions] = createDashboardStore();

  onMount(() => {
    void actions.bootstrap();
  });

  onCleanup(() => actions.shutdown());

  const phases = createMemo(() => state.snapshot?.phases ?? []);
  const selectedPhaseSlug = createMemo(() => state.selectedArtifact?.phase ?? null);
  const isInitialized = createMemo(() => state.snapshot?.is_initialized ?? false);

  const renderedArtifact = createMemo(() => {
    const sel = state.selectedArtifact;
    if (!sel) return null;
    return state.artifactCache.get(`${sel.phase}/${sel.name}`) ?? null;
  });

  const handleSelect = (phaseSlug: string, artifactName: string): void => {
    void actions.selectArtifact(phaseSlug, artifactName);
  };

  return (
    <div class="app-shell">
      <TopBar
        project={state.snapshot?.project ?? null}
        milestone={state.snapshot?.milestone ?? null}
        connection={state.connection}
        commandSubmitting={state.commandSubmitting}
        onCommand={actions.runCommand}
      />
      <Show
        when={isInitialized()}
        fallback={
          <main class="app-body app-body-greenfield">
            <InitScreen submitting={state.initSubmitting} onInit={actions.initProject} />
          </main>
        }
      >
        <main class="app-body">
          <div class="panel">
            <Show
              when={phases().length > 0}
              fallback={
                <div class="preview-panel-empty">
                  No phases yet. Run <code>swt vibe</code> from your terminal to scope a milestone,
                  or type <code>help</code> in the command bar above for available subcommands.
                </div>
              }
            >
              <PhaseStepper
                phases={phases()}
                currentIndex={state.snapshot?.milestone?.phase_index ?? 1}
                selectedPhase={selectedPhaseSlug()}
                onSelect={handleSelect}
              />
            </Show>
          </div>
          <div class="panel">
            <ArtifactTree
              phases={phases()}
              selected={state.selectedArtifact}
              onSelect={handleSelect}
            />
          </div>
          <div class="app-body-center">
            <ArtifactPreview
              selected={state.selectedArtifact}
              rendered={renderedArtifact()}
              loading={state.artifactLoading}
              error={state.artifactError}
              onRetry={() => {
                const sel = state.selectedArtifact;
                if (sel) handleSelect(sel.phase, sel.name);
              }}
            />
            <LogPanel lines={state.recentLogLines} />
          </div>
          <div class="app-body-right">
            <AgentTimeline events={state.snapshot?.recent_events ?? []} />
            <CostPanel cost={state.snapshot?.cost_summary ?? null} />
          </div>
        </main>
      </Show>
      <UatModal
        modal={state.uatModal}
        submitting={state.uatSubmitting}
        onSubmit={(result, note) => void actions.submitUatCheckpoint(result, note)}
        onClose={() => actions.closeUatModal()}
      />
    </div>
  );
};
