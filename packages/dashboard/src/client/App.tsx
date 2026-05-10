import Resizable from '@corvu/resizable';
import { Show, createMemo, onCleanup, onMount, type Component } from 'solid-js';

import { AgentTimeline } from './components/AgentTimeline.js';
import { ArtifactPreview } from './components/ArtifactPreview.js';
import { ArtifactTree } from './components/ArtifactTree.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { CostPanel } from './components/CostPanel.js';
import { DetectPhasePanel } from './components/DetectPhasePanel.js';
import { DoctorPanel } from './components/DoctorPanel.js';
import { InitScreen } from './components/InitScreen.js';
import { LogPanel } from './components/LogPanel.js';
import { PhaseStepper } from './components/PhaseStepper.js';
import { TopBar } from './components/TopBar.js';
import { UatModal } from './components/UatModal.js';
import { UpdatePanel } from './components/UpdatePanel.js';
import { loadLayout, saveLayout, type DashboardLayout } from './lib/layout-storage.js';
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
  const isBrownfield = createMemo(() => state.snapshot?.brownfield_detected ?? false);

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
    tools: [...initialLayout.tools],
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
            <InitScreen
              submitting={state.initSubmitting}
              brownfield={isBrownfield()}
              onInit={actions.initProject}
            />
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
                    <p class="empty-state-arrow" aria-hidden="true">
                      ↑
                    </p>
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
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize phase column"
            />
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
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize artifact tree"
            />
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
                <Resizable.Handle
                  class="resizable-handle resizable-handle-v"
                  aria-label="Resize preview / log"
                />
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
                    agentBackend={state.vibeSession?.agent_backend ?? null}
                  />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize right column"
            />
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
                <Resizable.Handle
                  class="resizable-handle resizable-handle-v"
                  aria-label="Resize agents / cost"
                />
                <Resizable.Panel
                  initialSize={initialLayout.right[1]}
                  minSize={0.15}
                  class="resizable-panel"
                >
                  <CostPanel cost={state.snapshot?.cost_summary ?? null} />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize tools column"
            />
            <Resizable.Panel
              initialSize={initialLayout.main[4]}
              minSize={0.08}
              class="resizable-panel resizable-stack"
            >
              <Resizable
                orientation="vertical"
                initialSizes={initialLayout.tools}
                onSizesChange={(sizes) => {
                  layout.tools = sizes;
                  persist();
                }}
                class="resizable-root resizable-root-v"
              >
                <Resizable.Panel
                  initialSize={initialLayout.tools[0]}
                  minSize={0.1}
                  class="resizable-panel"
                >
                  <ConfigPanel
                    data={state.tools.config.data}
                    loading={state.tools.config.loading}
                    error={state.tools.config.error}
                    lastFetched={state.tools.config.lastFetched}
                    onRefresh={() => void actions.refreshToolsCell('config')}
                    onSave={(config) => actions.applyConfigUpdate({ config })}
                  />
                </Resizable.Panel>
                <Resizable.Handle
                  class="resizable-handle resizable-handle-v"
                  aria-label="Resize config / doctor"
                />
                <Resizable.Panel
                  initialSize={initialLayout.tools[1]}
                  minSize={0.1}
                  class="resizable-panel"
                >
                  <DoctorPanel
                    data={state.tools.doctor.data}
                    loading={state.tools.doctor.loading}
                    error={state.tools.doctor.error}
                    lastFetched={state.tools.doctor.lastFetched}
                    onRefresh={() => void actions.refreshToolsCell('doctor')}
                  />
                </Resizable.Panel>
                <Resizable.Handle
                  class="resizable-handle resizable-handle-v"
                  aria-label="Resize doctor / detect-phase"
                />
                <Resizable.Panel
                  initialSize={initialLayout.tools[2]}
                  minSize={0.1}
                  class="resizable-panel"
                >
                  <DetectPhasePanel
                    data={state.tools.detectPhase.data}
                    loading={state.tools.detectPhase.loading}
                    error={state.tools.detectPhase.error}
                    lastFetched={state.tools.detectPhase.lastFetched}
                    onRefresh={() => void actions.refreshToolsCell('detectPhase')}
                  />
                </Resizable.Panel>
                <Resizable.Handle
                  class="resizable-handle resizable-handle-v"
                  aria-label="Resize detect-phase / update"
                />
                <Resizable.Panel
                  initialSize={initialLayout.tools[3]}
                  minSize={0.1}
                  class="resizable-panel"
                >
                  <UpdatePanel
                    data={state.tools.update.data}
                    loading={state.tools.update.loading}
                    error={state.tools.update.error}
                    lastFetched={state.tools.update.lastFetched}
                    onRefresh={() => void actions.refreshToolsCell('update')}
                  />
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
    </div>
  );
};
