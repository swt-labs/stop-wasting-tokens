import Resizable from '@corvu/resizable';
import type { SwtConfig, Theme } from '@swt-labs/core';
import { getContextWindow } from '@swt-labs/shared';
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';

import { ActiveAgentsPane } from './components/ActiveAgentsPane.js';
import { ArtifactPreview } from './components/ArtifactPreview.js';
import { CodebaseMapPrompt } from './components/CodebaseMapPrompt.js';
import { CommandPalette } from './components/CommandPalette.js';
import { CommandsSection } from './components/CommandsSection.js';
import { DashboardStatusline } from './components/DashboardStatusline.js';
import { InitScreen } from './components/InitScreen.js';
import { PhaseStepper } from './components/PhaseStepper.js';
import { PromptCard } from './components/PromptCard.js';
import { ProviderAuthPanel } from './components/ProviderAuthPanel.js';
import { selectStatuslineKnobs } from './components/statusline-helpers.js';
// Plan 01-03 — `ConfigPanel` deleted; the `tools` Resizable.Panel that
// used to host it is gone, and the `tools` array shrinks from 4 → 3
// entries. Config editing now lives entirely in the TopBar "Options ▾"
// dropdown (Settings curated + Advanced full tree + sticky Save).
// Plan 01-02 — `SettingsSection` is rendered inline inside `OptionsMenu`,
// fed by config props forwarded through `TopBar`. The immediate-apply
// `buildConfigPatch` helper retired alongside the JSX-prop slot.
import { TopBar } from './components/TopBar.js';
import { UatModal } from './components/UatModal.js';
import { UnifiedLogPanel } from './components/UnifiedLogPanel.js';
import { UserNotesPanel } from './components/UserNotesPanel.js';
import { WorktreesPanel } from './components/WorktreesPanel.js';
import { loadLayout, saveLayout, type DashboardLayout } from './lib/layout-storage.js';
import { applyTheme, isTheme } from './lib/themes-dropdown-helpers.js';
// Phase 04 — pure workflow-state helpers live in lib/workflow-state.ts (not
// inlined here) so the vitest node-environment can import them without
// dragging in App.tsx's JSX + @corvu/resizable client-only deps. Re-exported
// so any consumer that historically imported from '../App.js' keeps working.
import {
  deriveWorkflowState,
  firstActivePhasePosition,
  type WorkflowState,
} from './lib/workflow-state.js';
export { deriveWorkflowState, firstActivePhasePosition, type WorkflowState };
import { createDashboardStore } from './state/dashboard-store.js';

export const App: Component = () => {
  const [state, actions] = createDashboardStore();
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  // v2.3 Phase 03: cmd-K (mac) / ctrl-K (linux/win) opens the command
  // palette. The browser may capture cmd-K in some keyboard layouts
  // (e.g. focus URL bar); preventDefault overrides that within the
  // dashboard window. Removed in onCleanup so HMR doesn't leak listeners.
  const isPaletteShortcut = (e: KeyboardEvent): boolean =>
    e.key === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

  const handleKeydown = (e: KeyboardEvent): void => {
    if (isPaletteShortcut(e)) {
      e.preventDefault();
      setPaletteOpen((open) => !open);
    }
  };

  onMount(() => {
    void actions.bootstrap();
    window.addEventListener('keydown', handleKeydown);
  });

  onCleanup(() => {
    actions.shutdown();
    window.removeEventListener('keydown', handleKeydown);
  });

  const phases = createMemo(() => state.snapshot?.phases ?? []);
  const selectedPhaseSlug = createMemo(() => state.selectedArtifact?.phase ?? null);
  const isInitialized = createMemo(() => state.snapshot?.is_initialized ?? false);
  const isBrownfield = createMemo(() => state.snapshot?.brownfield_detected ?? false);

  // Phase 04 — derive the cook-bar's workflow state from existing store
  // fields. The memo recomputes whenever the snapshot, milestone,
  // phases, or vibeSession.status changes; TopBar consumes the value
  // via a required prop. See deriveWorkflowState's docblock for the
  // 5-state precedence matrix.
  const workflowState = createMemo<WorkflowState>(() =>
    deriveWorkflowState({
      isInitialized: state.snapshot?.is_initialized ?? false,
      phaseCount: state.snapshot?.milestone?.phase_count ?? 0,
      phases: state.snapshot?.phases ?? [],
      vibeSessionStatus: state.vibeSession?.status,
    }),
  );
  const activePhasePosition = createMemo<string | null>(() =>
    firstActivePhasePosition(state.snapshot?.phases ?? []),
  );

  const renderedArtifact = createMemo(() => {
    const sel = state.selectedArtifact;
    if (!sel) return null;
    return state.artifactCache.get(`${sel.phase}/${sel.name}`) ?? null;
  });

  // Statusline-extension milestone (step 6) — derived statusline props. Each
  // memo isolates one upstream signal so Solid only recomputes the relevant
  // statusline cell when its source changes, not on every snapshot tick.
  // The `knobs` memo runs `selectStatuslineKnobs` (drift-guarded) over the
  // config tools-cell so an out-of-band edit lands in the bar within one
  // SSE round-trip (acceptance criterion §4 in artifacts.md).
  const statuslineKnobs = createMemo(() => selectStatuslineKnobs(state.tools.config.data?.config));
  const statuslineContextWindow = createMemo(() => getContextWindow(state.orchestratorModel));
  // Statusline v2 Wave 2 — per-orchestrator-session input tokens. The v1
  // statusline read `cost_summary.tokens.{in,cache_read,cache_creation}`,
  // which is dashboard-lifetime cumulative (sums every cook session
  // since the dashboard started) and never decremented across session
  // boundaries — so after a few sessions `ctx ~Xk/Yk` lied about the
  // active session. The new `state.orchestratorSessionInputTokens` slot
  // (zeroed on `cook.priority_decision` + 10s after `cook.completion`)
  // is the correct per-session source; money cells continue to read
  // `cost_summary` directly because they ARE dashboard-lifetime.
  const statuslineCumulativeTokens = createMemo(() => state.orchestratorSessionInputTokens);
  // Statusline v2 Wave 5 commit 9 — git project-identity payload from
  // `snapshot.git`. Undefined for non-git workspaces; the Project group
  // hides entirely in that case (absence is the signal — SWT manages
  // non-git workspaces too).
  const statuslineGit = createMemo(() => state.snapshot?.git);

  // Theme — drive the dashboard's `data-theme` attribute on `<html>` from
  // the persisted config. The memo reads `state.tools.config.data?.config
  // ?.theme` (the canonical source) and falls back to `'default'` when
  // either (a) the dashboard is pre-init and no config.json exists, or
  // (b) the persisted config predates this milestone and has no `theme`
  // field. The createEffect ensures any change to the persisted theme —
  // whether from this dashboard's picker, a parallel tab, or a CLI
  // `swt config set theme dracula` — is reflected on `<html>` within one
  // SSE round-trip.
  const currentTheme = createMemo<Theme>(() => {
    // ConfigSnapshot.config is typed `unknown` in shared/schemas to keep
    // the cross-package wire boundary loose; the documented concrete
    // shape is `SwtConfig` from @swt-labs/core. Cast through that shape
    // so the read is typed-safe end-to-end.
    const config = state.tools.config.data?.config as SwtConfig | undefined;
    const t = config?.theme;
    return isTheme(t) ? t : 'default';
  });
  createEffect(() => {
    applyTheme(currentTheme());
  });

  // Theme-selection handler — merges the new theme into the existing
  // config and dispatches the canonical save action. Pre-init dashboards
  // (no `state.tools.config.data`) skip persistence; the optimistic
  // apply inside `<ThemesDropdown>` still gave the user visual feedback.
  // On save failure (rare — file-write errors), the effect re-applies
  // the canonical theme so the picker can't drift away from the truth.
  const handleSelectTheme = async (theme: Theme): Promise<void> => {
    const current = state.tools.config.data?.config as SwtConfig | undefined;
    if (!current) return;
    const result = await actions.applyConfigUpdate({ config: { ...current, theme } });
    if ('error' in result) {
      applyTheme(currentTheme());
    }
  };

  // alpha.35: Model-selection handler — mirrors handleSelectTheme exactly.
  // The TopBar Model dropdown writes `config.model` so spawn callsites
  // (cook, init Lead, chat session) can read it and override the
  // `model_profile` resolution chain when set.
  const handleSelectModel = async (modelId: string): Promise<void> => {
    const current = state.tools.config.data?.config as SwtConfig | undefined;
    if (!current) return;
    await actions.applyConfigUpdate({ config: { ...current, model: modelId } });
  };

  // Current values for the TopBar's Model dropdown — derived from the
  // same `state.tools` cells the rest of the App uses, so SSE
  // `state.changed` events keep the dropdown in sync with parallel writes.
  const currentProviderId = (): string | null =>
    state.tools.providerAuth.data?.selected_provider ?? null;
  const currentModel = (): string | null => {
    const config = state.tools.config.data?.config as SwtConfig | undefined;
    return config?.model ?? null;
  };

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
        workflowState={workflowState()}
        activePhasePosition={activePhasePosition()}
        onCommand={actions.runCommand}
        onVibe={actions.startVibeSession}
        onChat={actions.startChat}
        cookAwaitingUser={state.cookAwaitingUser}
        onCookAskUserRespond={async (text: string) => {
          const cau = state.cookAwaitingUser;
          if (!cau) return;
          await actions.respondToCookAskUser(cau.askUserId, {
            selectedOption: null,
            freeform: text,
          });
        }}
        optionsMenuOpen={state.optionsMenuOpen}
        onToggleOptionsMenu={actions.toggleOptionsMenu}
        onCloseOptionsMenu={actions.closeOptionsMenu}
        providerMenuOpen={state.providerMenuOpen}
        onToggleProviderMenu={actions.toggleProviderMenu}
        onCloseProviderMenu={actions.closeProviderMenu}
        providerSection={
          <ProviderAuthPanel
            data={state.tools.providerAuth.data}
            loading={state.tools.providerAuth.loading}
            error={state.tools.providerAuth.error}
            lastFetched={state.tools.providerAuth.lastFetched}
            onRefresh={() => void actions.refreshToolsCell('providerAuth')}
            onSave={(body) => actions.applyProviderAuthUpdate(body)}
            oauthFlow={state.oauthFlow}
            onStartOAuth={(provider) => actions.startOAuthFlow(provider)}
            onSubmitOAuthCode={(code) => actions.submitOAuthCode(code)}
            onDismissOAuthFlow={() => actions.dismissOAuthFlow()}
          />
        }
        commandsSection={
          <CommandsSection
            verbs={state.tools.commands.data?.verbs ?? []}
            loading={state.tools.commands.loading}
            error={state.tools.commands.error}
            onRunSafeVerb={(verb) => actions.runCommand(verb)}
            onStartCook={() => actions.startVibeSession('vibe')}
            lastResult={null}
          />
        }
        // Plan 01-02 — OptionsMenu owns the SettingsSection + Advanced render
        // inline (so both can read its local `pendingEdits` signal). App.tsx
        // forwards the config tools-cell + the Save handler through TopBar
        // instead of constructing a `<SettingsSection>` JSX slot. The deep-
        // merge that the old `buildConfigPatch` provided now lives in
        // `mergeStagedConfig` (called from inside OptionsMenu's Save handler).
        optionsMenuConfigData={state.tools.config.data}
        optionsMenuConfigLoading={state.tools.config.loading}
        optionsMenuConfigError={state.tools.config.error}
        optionsMenuConfigLastFetched={state.tools.config.lastFetched}
        onOptionsMenuRefreshConfig={() => void actions.refreshToolsCell('config')}
        onOptionsMenuSaveConfig={(merged) => actions.applyConfigUpdate({ config: merged })}
        currentTheme={currentTheme()}
        onSelectTheme={(theme) => void handleSelectTheme(theme)}
        currentProviderId={currentProviderId()}
        currentModel={currentModel()}
        onSelectModel={(modelId) => void handleSelectModel(modelId)}
      />
      <Show
        when={isInitialized()}
        fallback={
          <main class="app-body app-body-greenfield">
            <InitScreen
              submitting={state.initSubmitting}
              brownfield={isBrownfield()}
              initSession={() => state.initSession}
              onInit={actions.initProject}
              isMappingCodebase={() => state.isMappingCodebase}
              onMapCodebase={() => void actions.startCodebaseMap()}
            />
          </main>
        }
      >
        <main class="app-body">
          {/* Milestone 23 Phase 03 — persistent banner that surfaces the
              codebase-mapping affordance for brownfield projects that have
              NOT yet been mapped. Conditional render lives inside
              `<CodebaseMapPrompt>` (its `shouldShowMapPrompt(snapshot)` Show
              guard). Auto-hides via SSE-driven `state.changed` once
              `snapshot.codebase_mapped` flips to `true`. Mounted INSIDE the
              `isInitialized()` branch (Scout Drift 9) so it only renders
              for actually-initialized projects. */}
          <CodebaseMapPrompt
            snapshot={() => state.snapshot}
            isMappingCodebase={() => state.isMappingCodebase}
            onMapCodebase={() => void actions.startCodebaseMap()}
          />
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
              {/* alpha.20 — empty-state CTA card removed at user request.
                  The TopBar's cook-bar placeholder + workflow-state hint
                  already cue the user toward the next action; this card
                  was redundant in the left column. When `phases().length === 0`
                  the panel renders empty. */}
              {/* Milestone 14 — PHASES + ARTIFACTS panes merged into a
                  single PhaseStepper card. The previously-adjacent
                  ArtifactTree panel is gone; its per-phase file list
                  now expands inside each PhaseCard row. `main` array
                  drops from 5 to 4 entries (see lib/layout-storage.ts
                  v7 → v8). */}
              {/* Panel header — always visible (empty state + populated
                  state both show "Plans"). Lifted out of PhaseStepper so
                  the empty fallback also has a title. */}
              <h2 class="panel-header">Plans</h2>
              <Show when={phases().length > 0} fallback={<div class="preview-panel-empty" />}>
                <PhaseStepper
                  phases={phases()}
                  currentIndex={state.snapshot?.milestone?.phase_index ?? 1}
                  selectedPhase={selectedPhaseSlug()}
                  selectedArtifact={state.selectedArtifact}
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
                  {/* Milestone 13 / Phase 01 — single chronological feed.
                      Replaces the prior chat-session-keyed mode-switch
                      between the legacy log + chat panels. UnifiedLogPanel
                      always mounts; the panel itself dispatches per-kind
                      rendering via `classifyEntry`. The structural removal
                      of the chat-session-keyed `<Show>` wrapper also closes
                      the alpha.24 "cook output hidden behind stale chat
                      bubble" bug as a byproduct (milestone CONTEXT.md
                      decision — no interim hotfix). */}
                  <UnifiedLogPanel
                    log={state.unifiedLog}
                    conversation={state.vibeSession?.conversation ?? []}
                    replying={state.vibeReplying}
                    chatStreaming={state.chatStreaming}
                    onReply={actions.replyToActivePrompt}
                    agentBackend={state.vibeSession?.agent_backend ?? null}
                    onClearChat={actions.clearChat}
                    onCookAskUserRespond={(askUserId, response) =>
                      actions.respondToCookAskUser(askUserId, response)
                    }
                  />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize right column"
            />
            <Resizable.Panel
              initialSize={initialLayout.main[2]}
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
                  <PromptCard />
                  <ActiveAgentsPane
                    agents={() => state.activeAgents}
                    sessionId={() => state.activeSessionId}
                    events={state.snapshot?.recent_events ?? []}
                    selectArtifact={(phase, artifact) =>
                      void actions.selectArtifact(phase, artifact)
                    }
                  />
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
                  <WorktreesPanel />
                </Resizable.Panel>
              </Resizable>
            </Resizable.Panel>
            <Resizable.Handle
              class="resizable-handle resizable-handle-h"
              aria-label="Resize tools column"
            />
            <Resizable.Panel
              initialSize={initialLayout.main[3]}
              minSize={0.08}
              class="resizable-panel resizable-stack"
            >
              {/* Tools column: a single panel.
                  v10 — DoctorPanel + DetectPhasePanel were removed at user
                  request (they were diagnostic-only and not driving the
                  daily flow). UserNotesPanel is the sole occupant, so the
                  inner vertical Resizable wrapper is gone too — one panel
                  doesn't need resizing. The persisted `tools` array shrinks
                  to `[]`; see `lib/layout-storage.ts` for the v9 → v10
                  storage-key bump. Plan 01-03's pre-bump trio
                  (Doctor / DetectPhase / UserNotes) is now just
                  UserNotes. */}
              <UserNotesPanel
                data={state.tools.userNotes.data}
                loading={state.tools.userNotes.loading}
                error={state.tools.userNotes.error}
                lastFetched={state.tools.userNotes.lastFetched}
                onRefresh={() => void actions.refreshToolsCell('userNotes')}
                onSave={(notes) => actions.saveUserNotes(notes)}
              />
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
      <CommandPalette
        open={paletteOpen()}
        onClose={() => setPaletteOpen(false)}
        onRun={async (verb) => {
          await actions.runCommand(verb);
        }}
        verbs={state.tools.commands.data?.verbs ?? []}
      />
      {/* Phase 02 T3 — viewport-fixed bottom statusline. Mounts UNCONDITIONALLY
          outside the `isInitialized()` Show gate per Scout Q6 + CONTEXT.md;
          `z-index: 10` on `.dashboard-statusline` clears the normal-flow
          InitScreen.
          Statusline-extension milestone (step 5) — widened from 3 to 8
          props. Step 6 will refactor these direct reads to `createMemo`
          so reactivity recomputes only when the underlying signals
          change. */}
      <DashboardStatusline
        providerAuth={state.tools.providerAuth.data ?? null}
        connectionState={state.connection}
        git={statuslineGit()}
        activeSessionId={state.activeSessionId}
        costSummary={state.snapshot?.cost_summary ?? null}
        usageRollup={state.snapshot?.usage_rollup ?? null}
        knobs={statuslineKnobs()}
        orchestratorModel={state.orchestratorModel ?? currentModel()}
        activeAgents={state.activeAgents}
        contextWindow={statuslineContextWindow()}
        cumulativeInputTokens={statuslineCumulativeTokens()}
      />
    </div>
  );
};
