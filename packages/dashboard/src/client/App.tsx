import Resizable from '@corvu/resizable';
import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';

import { AgentTimeline } from './components/AgentTimeline.js';
import { ArtifactPreview } from './components/ArtifactPreview.js';
import { ArtifactTree } from './components/ArtifactTree.js';
import { CostPanel } from './components/CostPanel.js';
import { InitScreen } from './components/InitScreen.js';
import { LogPanel } from './components/LogPanel.js';
import { OnboardingOverlay } from './components/OnboardingOverlay.js';
import { PhaseStepper } from './components/PhaseStepper.js';
import { TopBar } from './components/TopBar.js';
import { UatModal } from './components/UatModal.js';
import { loadLayout, saveLayout, type DashboardLayout } from './lib/layout-storage.js';
import {
  markOnboardingDismissed,
  shouldShowOnboarding,
} from './lib/onboarding-storage.js';
import { createDashboardStore } from './state/dashboard-store.js';

export const App: Component = () => {
  const [state, actions] = createDashboardStore();
  const [onboardingVisible, setOnboardingVisible] = createSignal(shouldShowOnboarding());

  onMount(() => {
    void actions.bootstrap();
  });

  onCleanup(() => actions.shutdown());

  const dismissOnboarding = (): void => {
    markOnboardingDismissed();
    setOnboardingVisible(false);
  };

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

  const initialLayout = loadLayout();
  const layout: DashboardLayout = {
    main: [...initialLayout.main],
    center: [...initialLayout.center],
    right: [...initialLayout.right],
  };
  const persist = (): void => saveLayout(layout);

  return (
    <div class="app-shell">
      <TopBar
        project={state.snapshot?.project ?? null}
        milestone={state.snapshot?.milestone ?? null}
        connection={state.connection}
        commandSubmitting={state.commandSubmitting}
        vibeStarting={state.vibeStarting}
        onCommand={actions.runCommand}
        onVibe={actions.startVibeSession}
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
          <Resizable
            orientation="horizontal"
            initialSizes={initialLayout.main}
            onSizesChange={(sizes) => {
              layout.main = sizes;
              persist();
            }}
            class="resizable-root resizable-root-h"
          >
            <Resizable.Panel
              initialSize={initialLayout.main[0]}
              minSize={0.08}
              class="panel resizable-panel"
            >
              <Show
                when={phases().length > 0}
                fallback={
                  <div class="preview-panel-empty empty-state-cta">
                    <p class="empty-state-headline">Describe what you want to build</p>
                    <p class="empty-state-arrow" aria-hidden="true">↑</p>
                    <p class="empty-state-hint">
                      Type your idea in the command bar above. The agent will ask follow-up
                      questions if it needs anything from you.
                    </p>
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
            </Resizable.Panel>
            <Resizable.Handle class="resizable-handle resizable-handle-h" aria-label="Resize phase column" />
            <Resizable.Panel
              initialSize={initialLayout.main[1]}
              minSize={0.08}
              class="panel resizable-panel"
            >
              <ArtifactTree
                phases={phases()}
                selected={state.selectedArtifact}
                onSelect={handleSelect}
              />
            </Resizable.Panel>
            <Resizable.Handle class="resizable-handle resizable-handle-h" aria-label="Resize artifact tree" />
            <Resizable.Panel
              initialSize={initialLayout.main[2]}
              minSize={0.25}
              class="resizable-panel resizable-stack"
            >
              <Resizable
                orientation="vertical"
                initialSizes={initialLayout.center}
                onSizesChange={(sizes) => {
                  layout.center = sizes;
                  persist();
                }}
                class="resizable-root resizable-root-v"
              >
                <Resizable.Panel
                  initialSize={initialLayout.center[0]}
                  minSize={0.15}
                  class="resizable-panel"
                >
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
                </Resizable.Panel>
                <Resizable.Handle class="resizable-handle resizable-handle-v" aria-label="Resize preview / log" />
                <Resizable.Panel
                  initialSize={initialLayout.center[1]}
                  minSize={0.1}
                  class="resizable-panel"
                >
                  <LogPanel
                    lines={state.recentLogLines}
                    conversation={state.vibeSession?.conversation ?? []}
                    replying={state.vibeReplying}
                    onReply={actions.replyToActivePrompt}
                  />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
            <Resizable.Handle class="resizable-handle resizable-handle-h" aria-label="Resize right column" />
            <Resizable.Panel
              initialSize={initialLayout.main[3]}
              minSize={0.1}
              class="resizable-panel resizable-stack"
            >
              <Resizable
                orientation="vertical"
                initialSizes={initialLayout.right}
                onSizesChange={(sizes) => {
                  layout.right = sizes;
                  persist();
                }}
                class="resizable-root resizable-root-v"
              >
                <Resizable.Panel
                  initialSize={initialLayout.right[0]}
                  minSize={0.2}
                  class="resizable-panel"
                >
                  <AgentTimeline events={state.snapshot?.recent_events ?? []} />
                </Resizable.Panel>
                <Resizable.Handle class="resizable-handle resizable-handle-v" aria-label="Resize agents / cost" />
                <Resizable.Panel
                  initialSize={initialLayout.right[1]}
                  minSize={0.15}
                  class="resizable-panel"
                >
                  <CostPanel cost={state.snapshot?.cost_summary ?? null} />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
          </Resizable>
        </main>
      </Show>
      <UatModal
        modal={state.uatModal}
        submitting={state.uatSubmitting}
        onSubmit={(result, note) => void actions.submitUatCheckpoint(result, note)}
        onClose={() => actions.closeUatModal()}
      />
      <OnboardingOverlay visible={onboardingVisible()} onDismiss={dismissOnboarding} />
    </div>
  );
};
