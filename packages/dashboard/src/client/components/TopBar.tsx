import type { ConfigSnapshot, MilestoneSummary, ProjectSummary } from '@swt-labs/shared';
import { Show, createMemo, createSignal, For, type Component, type JSX } from 'solid-js';

import type { WorkflowState } from '../lib/workflow-state.js';
import type { ConnectionState } from '../state/dashboard-store.js';

import { formatAskUserPlaceholder } from './askuser-card-helpers.js';
import { OptionsMenu } from './OptionsMenu.js';
import { ProviderMenu } from './ProviderMenu.js';

/**
 * Phase 03 — placeholder cap for answer-mode. Matches
 * `formatAskUserPlaceholder`'s default (100 chars) so a runaway long
 * question cannot blow out the input's visual width.
 */
const MAX_PLACEHOLDER_LEN = 100;

export interface TopBarProps {
  project: ProjectSummary | null;
  milestone: MilestoneSummary | null;
  connection: ConnectionState;
  commandSubmitting: boolean;
  vibeStarting: boolean;
  /**
   * Phase 04 — the current workflow state driving the cook-bar
   * placeholder/hint matrix. Required: App.tsx must always pass it
   * (compile-time guarantee that the placeholder/hint cannot silently
   * regress to the verb-only fallback). Derivation lives in App.tsx
   * `deriveWorkflowState`; the 5-state matrix is documented in
   * 04-01-PLAN.md. Only consulted when the selected verb is 'cook'.
   */
  workflowState: WorkflowState;
  /**
   * Phase 04 — the two-digit `position` of the first non-done phase,
   * or null when no such phase exists. Interpolated into the hint
   * string (`↵ plan phase {NN}` / `↵ execute phase {NN}`). When null
   * the hint falls back to a generic `↵ plan next phase` /
   * `↵ execute next phase`.
   */
  activePhasePosition: string | null;
  onCommand: (input: string) => Promise<unknown>;
  onVibe: (input: string) => Promise<unknown>;
  /**
   * Phase 02 (milestone 12 — free-talk mode) — optional neutral-mode dispatch.
   * When `verb() === null` (the new default), `onSubmit` short-circuits to
   * `props.onChat?.(trimmed)` BEFORE composeCommand, so the bar speaks
   * directly with the LLM. Optional so App.tsx stays unedited this phase;
   * Phase 03 wires `onChat={actions.startChat}` end-to-end. When omitted,
   * a neutral-mode submit clears the input and otherwise no-ops (the
   * slate-muted styling is the user-visible contract).
   */
  onChat?: (text: string) => Promise<unknown>;
  /**
   * Milestone 13 / Phase 03 — when non-null, TopBar enters answer-mode
   * (verb chip disabled + clear-× hidden + placeholder driven by
   * `formatAskUserPlaceholder` + submit routes to `onCookAskUserRespond`
   * BEFORE the chat/verb branches + Send button labelled 'Answer' +
   * `topbar-cmd-answer-mode` form class + banner). The mode-precedence
   * is locked: cook-ask-user > chat > vibe > command (Scout §5 +
   * cross-cutting #6). Optional so App.tsx and tests can omit it.
   */
  cookAwaitingUser?: {
    askUserId: string;
    question: string;
    options: Array<{ value: string; label: string; description?: string }>;
    allowFreeform: boolean;
  } | null;
  /**
   * Milestone 13 / Phase 03 — answer-mode submit handler. Only
   * freeform text is routed through the TopBar; option-button choice
   * happens on `<AskUserCard>` directly. When `answerMode()` is true,
   * the trimmed input is passed to this handler (the action maps it to
   * `{selectedOption: null, freeform: text}` before POSTing).
   */
  onCookAskUserRespond?: (text: string) => Promise<unknown>;
  /**
   * Phase 1 (Dashboard Options Menu) — store-backed open state; when omitted,
   * TopBar falls back to a local signal so the dropdown is visibly working
   * end-to-end with zero `App.tsx` edit. Phase 2 adds the one-line `App.tsx`
   * wiring to pass these store-backed props in (see the plan's `## Decisions`).
   */
  optionsMenuOpen?: boolean;
  /** Phase 1 — store-backed toggle; when omitted, TopBar toggles its local signal. */
  onToggleOptionsMenu?: () => void;
  /** Phase 1 — store-backed close; when omitted, TopBar closes its local signal. */
  onCloseOptionsMenu?: () => void;
  /**
   * Phase 3 (Dashboard Options Menu) — the Commands section content mounted
   * into OptionsMenu's `commandsSection` slot. Optional: when App.tsx does
   * not pass it, OptionsMenu falls back to its Phase-1 'Coming soon' skeleton.
   */
  commandsSection?: JSX.Element;
  /**
   * Plan 01-02 retired the Settings JSX slot — OptionsMenu now renders the
   * SettingsSection + AdvancedConfigSection inline so they can read its
   * local `pendingEdits` signal directly. The prop is kept on TopBar for
   * back-compat (an App.tsx still passing it does nothing harmful — the
   * OptionsMenu accepts-and-ignores the slot). Plan 01-03 drops it when
   * ConfigPanel is removed.
   */
  settingsSection?: JSX.Element;
  /**
   * Plan 01-02 — config tools-cell snapshot forwarded into the inlined
   * SettingsSection + AdvancedConfigSection inside OptionsMenu. Optional
   * so existing TopBar callers don't have to thread these props through
   * before plan 01-02 lands the Options-menu Save handler.
   */
  optionsMenuConfigData?: ConfigSnapshot | null;
  optionsMenuConfigLoading?: boolean;
  optionsMenuConfigError?: string | null;
  optionsMenuConfigLastFetched?: string | null;
  onOptionsMenuRefreshConfig?: () => void;
  onOptionsMenuSaveConfig?: (mergedConfig: unknown) => Promise<{ ok: true } | { error: string }>;
  /**
   * The "Provider ▾" dropdown's store-backed open state. Optional + mirrors
   * the `optionsMenuOpen` trio: when omitted, TopBar drives the dropdown off
   * a local signal so it works end-to-end with zero App.tsx edit.
   */
  providerMenuOpen?: boolean;
  /** Store-backed toggle for the Provider dropdown; local-signal fallback when omitted. */
  onToggleProviderMenu?: () => void;
  /** Store-backed close for the Provider dropdown; local-signal fallback when omitted. */
  onCloseProviderMenu?: () => void;
  /**
   * The `<ProviderAuthPanel>` element mounted into the "Provider ▾" dropdown
   * body — passed as a JSX slot so the panel's reactive store bindings
   * survive the hand-off (same idiom as `commandsSection` / `settingsSection`).
   * Optional: when omitted the "Provider ▾" trigger is not rendered at all.
   */
  providerSection?: JSX.Element;
}

const PILL_LABEL: Record<ConnectionState, string> = {
  connecting: '◇ CONNECTING',
  syncing: '◇ SYNCING',
  connected: '◯ CONNECTED',
  error: '✗ DISCONNECTED',
};

// alpha.20 — BACKEND_LABEL removed alongside the `backend: pi` chip.
// Restore here when a second backend ships.

// The verb dropdown's curated action-verb set. cook is the orchestrator
// (routes via onVibe); the rest are dashboard-safe CLI verbs (route via
// onCommand). `requiresInput` gates the submit button — cook/research need
// a prompt/topic; qa/verify/map take optional-or-no args.
//
// Hand-maintained, mirroring the (now removed) `ALLOWLIST` const pattern:
// a curated 5-item list does not warrant threading from the store.
export const ACTION_VERBS = [
  { value: 'cook', label: 'cook', requiresInput: true },
  { value: 'research', label: 'research', requiresInput: true },
  { value: 'qa', label: 'qa', requiresInput: false },
  { value: 'verify', label: 'verify', requiresInput: false },
  { value: 'map', label: 'map', requiresInput: false },
] as const;

/** The result of composing a selected verb + the typed input into a route. */
export interface ComposedCommand {
  /** `vibe` → the orchestrator path (`onVibe`); `command` → a CLI verb (`onCommand`). */
  route: 'vibe' | 'command';
  /** The fully composed string handed to the routing callback. */
  value: string;
}

/**
 * Composes the selected dropdown verb + the user's typed content into the
 * routed command. `cook` is the orchestrator: the input IS the cook prompt,
 * so it routes through `vibe` with the bare trimmed text (no "cook " prefix).
 * Every other verb routes through `command` as `${verb} ${trimmedInput}`,
 * collapsing to just `verb` when the input is empty.
 */
export function composeCommand(verb: string | null, input: string): ComposedCommand {
  const trimmed = input.trim();
  // Phase 02 — defensive fall-through for the neutral sentinel. The onSubmit
  // short-circuit returns before composeCommand when verb === null in normal
  // flow; this branch keeps the helper total. The `'vibe'` route is
  // arbitrary (never reached); we intentionally do NOT add a new `'chat'`
  // route discriminator to ComposedCommand to avoid cascading type changes
  // across helpers without functional benefit.
  if (verb === null) {
    return { route: 'vibe', value: trimmed };
  }
  if (verb === 'cook') {
    return { route: 'vibe', value: trimmed };
  }
  return { route: 'command', value: trimmed ? `${verb} ${trimmed}` : verb };
}

/**
 * Whether the form can submit for the given verb + input. A verb whose
 * `requiresInput` is true (cook/research) needs non-empty trimmed input;
 * the optional-arg verbs (qa/verify/map) can always submit.
 */
export function canSubmit(verb: string | null, input: string): boolean {
  // Phase 02 (milestone 12) — null is the neutral chat sentinel. MUST appear
  // before the ACTION_VERBS.find lookup: without this guard, the lookup
  // returns undefined and the function wrongly returns `true` for empty
  // chat input.
  if (verb === null) return input.trim().length > 0;
  const entry = ACTION_VERBS.find((v) => v.value === verb);
  if (entry?.requiresInput) {
    return input.trim().length > 0;
  }
  return true;
}

/**
 * Phase 03 — submit gate for TopBar answer-mode. Answer-mode is only
 * freeform text (option clicks happen on `<AskUserCard>` directly), so
 * the gate is exactly "trimmed text is non-empty" — Scout §8
 * shallow-acceptance prevention. Exported for direct unit-testing
 * (mirrors `canSubmit` / `composeCommand`).
 */
export function canSubmitAnswerMode(input: string): boolean {
  return input.trim().length > 0;
}

/** Verb-aware hint text describing what pressing ↵ / Run will do.
 *  Cook-verb branches on workflow state when supplied (Phase 04). */
export function hintForVerb(
  verb: string | null,
  workflowState?: WorkflowState,
  activePhasePosition?: string | null,
): string {
  // Phase 02 — null = neutral chat sentinel. Hint row is currently
  // unrendered (alpha.20 JSX cleanup) but the helper stays exported +
  // tested for forward-compat.
  if (verb === null) return '↵ chat';
  if (verb === 'cook' && workflowState !== undefined) {
    switch (workflowState) {
      case 'greenfield':
        return '↵ scope your first phase';
      case 'scoped_unplanned':
        return activePhasePosition ? `↵ plan phase ${activePhasePosition}` : '↵ plan next phase';
      case 'planned_unexecuted':
        return activePhasePosition
          ? `↵ execute phase ${activePhasePosition}`
          : '↵ execute next phase';
      case 'cook_running':
        return '↵ double-Enter for a new session';
      case 'all_done':
        return '↵ milestone complete';
    }
  }
  switch (verb) {
    case 'cook':
      return '↵ start a cook session';
    case 'research':
      return '↵ research <your text>';
    case 'qa':
      return '↵ run qa (optional phase arg)';
    case 'verify':
      return '↵ run verify (optional phase arg)';
    case 'map':
      return '↵ run map';
    default:
      return '↵ run';
  }
}

/** Verb-aware input placeholder. Cook-verb branches on workflow state
 *  when supplied (Phase 04); all other verbs ignore it. */
export function placeholderForVerb(verb: string | null, workflowState?: WorkflowState): string {
  // Phase 02 — null = neutral chat sentinel. Short, friendly, mirrors the
  // Phase-03 ChatPanel empty-state copy.
  if (verb === null) return 'Chat with the LLM…';
  if (verb === 'cook' && workflowState !== undefined) {
    switch (workflowState) {
      case 'greenfield':
        return 'Describe what you want to build';
      case 'scoped_unplanned':
        return 'Press Enter to plan the next phase';
      case 'planned_unexecuted':
        return 'Press Enter to execute';
      case 'cook_running':
        return 'Cook session running…';
      case 'all_done':
        return 'Run /vbw:status';
    }
  }
  switch (verb) {
    case 'cook':
      return 'Describe what you want built…';
    case 'research':
      return 'Topic to research…';
    case 'qa':
    case 'verify':
      return 'Phase number (optional)…';
    case 'map':
      return '(no input needed)';
    default:
      return 'Enter command input…';
  }
}

export const TopBar: Component<TopBarProps> = (props) => {
  const [input, setInput] = createSignal('');
  // Phase 02 (milestone 12 — free-talk mode) — neutral chat is the DEFAULT.
  // The selected verb is local TopBar UI state — not in the store, not
  // persisted (keep it simple, mirroring the `input` signal). null is the
  // chat sentinel; selecting cook/research/qa/verify/map from the <select>
  // flips to command mode. Clicking the `×` chip returns to neutral.
  const [verb, setVerb] = createSignal<string | null>(null);

  // Phase 03 — answer-mode is reactive off `cookAwaitingUser`. When the
  // SSE prompt.response arrives and clears the slot, `answerMode()`
  // flips back to false and the TopBar returns to its prior verb/chat
  // mode automatically (sticky verb signal is preserved across the
  // answer-mode round-trip).
  const answerMode = createMemo(() => props.cookAwaitingUser != null);

  // alpha.20 — `hint` memo removed alongside the hint row in JSX. The
  // `hintForVerb` helper stays exported (consumed by test files).
  // Phase 03 — when in answer-mode, the placeholder is the truncated
  // cook question (formatAskUserPlaceholder); otherwise fall through to
  // the existing verb/workflow-state matrix.
  const placeholder = createMemo(() => {
    if (answerMode() && props.cookAwaitingUser) {
      return formatAskUserPlaceholder(props.cookAwaitingUser.question, MAX_PLACEHOLDER_LEN);
    }
    return placeholderForVerb(verb(), props.workflowState);
  });

  // Phase 1 — the "Options ▾" dropdown. The three menu props are OPTIONAL so
  // `App.tsx` (out of this plan's files_modified) needs no edit; when they
  // are absent TopBar drives the dropdown off a local signal. `triggerRef`
  // is held so `closeMenu` can return focus to the trigger button (R5) —
  // TopBar owns the focus-return, OptionsMenu only calls `onClose`.
  let triggerRef: HTMLButtonElement | undefined;
  const [localOpen, setLocalOpen] = createSignal(false);
  const menuOpen = (): boolean => props.optionsMenuOpen ?? localOpen();
  const toggleMenu = (): void => {
    if (props.onToggleOptionsMenu) props.onToggleOptionsMenu();
    else setLocalOpen((v) => !v);
  };
  const closeMenu = (): void => {
    if (props.onCloseOptionsMenu) props.onCloseOptionsMenu();
    else setLocalOpen(false);
    triggerRef?.focus(); // focus-return to the trigger (R5)
  };

  // The "Provider ▾" dropdown — mirrors the Options-menu block above
  // exactly. The three props are OPTIONAL so TopBar drives the dropdown off
  // a local signal when App.tsx omits them; `providerTriggerRef` is held so
  // `closeProviderMenu` can return focus to the trigger button.
  let providerTriggerRef: HTMLButtonElement | undefined;
  const [localProviderOpen, setLocalProviderOpen] = createSignal(false);
  const providerMenuOpen = (): boolean => props.providerMenuOpen ?? localProviderOpen();
  const toggleProviderMenu = (): void => {
    if (props.onToggleProviderMenu) props.onToggleProviderMenu();
    else setLocalProviderOpen((v) => !v);
  };
  const closeProviderMenu = (): void => {
    if (props.onCloseProviderMenu) props.onCloseProviderMenu();
    else setLocalProviderOpen(false);
    providerTriggerRef?.focus(); // focus-return to the trigger
  };

  const onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Phase 03 — answer-mode branch MUST short-circuit BEFORE the
    // chat/verb branches. Mode precedence: cook-ask-user > chat > vibe
    // > command (Scout §5 + cross-cutting #6). When the slot is set,
    // the trimmed input goes to onCookAskUserRespond; option-button
    // choice happens on <AskUserCard> directly.
    if (answerMode()) {
      const text = input().trim();
      if (!canSubmitAnswerMode(input())) return;
      setInput('');
      await props.onCookAskUserRespond?.(text);
      return;
    }
    const selectedVerb = verb();
    if (!canSubmit(selectedVerb, input())) return;
    // Phase 02 — neutral chat branch MUST short-circuit BEFORE composeCommand.
    // When verb is null, route directly to props.onChat (optional — Phase 03
    // wires it from App.tsx). If onChat is unwired, the submit clears the
    // input and no-ops; the slate-muted styling is the user contract.
    if (selectedVerb === null) {
      const text = input().trim();
      setInput('');
      await props.onChat?.(text);
      return;
    }
    const composed = composeCommand(selectedVerb, input());
    // Clear the typed content; leave the verb sticky — a user running
    // several cook prompts shouldn't have to re-pick it each time.
    setInput('');
    if (composed.route === 'vibe') {
      await props.onVibe(composed.value);
      return;
    }
    await props.onCommand(composed.value);
  };

  // Phase 03 GAP-02 — DELIBERATELY NOT gating on vibeSession !== null or
  // activeSessionId !== null. Rationale: the dashboard-store keeps the
  // vibeSession + activeSessionId populated for 10s AFTER cook.completion
  // (the activeAgents clear timer at dashboard-store.ts:537-544) so the
  // user can read the final agent.prompt + agent grid. Extending
  // controlsDisabled to gate on those signals would lock the Run button
  // for that 10s window, which is the worst time to lock it — the user
  // is most likely to type the next prompt RIGHT THEN. Double-spawn
  // protection lives downstream: cook.ts:probeForResume detects an
  // already-running cook process (live PID + status='in_progress' in
  // .execution-state.json) and aborts with abort_another_cook_running →
  // EXIT.RUNTIME_ERROR. The cook-start.ts watchdog (lines 185-213)
  // catches the early exit and publishes cook.error(COOK_SPAWN_FAILED)
  // which the event bus surfaces as a toast. This is reactive, not
  // preventive — but the toast text is informative and the user
  // immediately understands why their second Enter didn't start a new
  // session. See .vbw-planning/phases/03-plan-execute-dashboard/03-RESEARCH.md
  // §C.2 + §C.3 for the full chain.
  const controlsDisabled = (): boolean => props.commandSubmitting || props.vibeStarting;

  return (
    <header class="topbar" role="banner">
      <h1 class="topbar-brand">
        <span class="topbar-brand-mark">swt</span>
        <span class="topbar-brand-cursor">_</span>
      </h1>
      <div class="topbar-cmd-wrapper">
        <Show when={answerMode() && props.cookAwaitingUser}>
          <div class="topbar-answer-mode-banner" role="status">
            <span class="topbar-answer-mode-banner-label">Cook asks:</span>{' '}
            <span class="topbar-answer-mode-banner-question">
              {formatAskUserPlaceholder(props.cookAwaitingUser!.question, MAX_PLACEHOLDER_LEN)}
            </span>
          </div>
        </Show>
        <form
          class="topbar-cmd"
          classList={{
            'topbar-cmd-neutral': verb() === null && !answerMode(),
            'topbar-cmd-answer-mode': answerMode(),
          }}
          onSubmit={(e) => void onSubmit(e)}
          aria-label="Run swt command"
        >
          <select
            class="topbar-cmd-verb"
            aria-label="Command"
            disabled={controlsDisabled() || answerMode()}
            value={verb() ?? ''}
            onChange={(e) => setVerb(e.currentTarget.value || null)}
          >
            <option value="" disabled>
              chat
            </option>
            <For each={ACTION_VERBS}>{(v) => <option value={v.value}>{v.label}</option>}</For>
          </select>
          <Show when={verb() !== null && !answerMode()}>
            <button
              type="button"
              class="topbar-cmd-clear"
              aria-label="Clear verb (return to chat)"
              onClick={() => setVerb(null)}
              disabled={controlsDisabled()}
            >
              ×
            </button>
          </Show>
          <span class="topbar-cmd-prompt">$</span>
          {/* TODO(milestone-12): defer multiline/textarea to a follow-up phase per CONTEXT.md
              "Multi-line input + markdown rendering — defer until base UX is validated". */}
          <input
            type="text"
            class="topbar-cmd-input"
            placeholder={placeholder()}
            autocomplete="off"
            spellcheck={false}
            disabled={controlsDisabled()}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
          />
          <button
            type="submit"
            class="topbar-cmd-submit"
            disabled={
              controlsDisabled() ||
              (answerMode() ? !canSubmitAnswerMode(input()) : !canSubmit(verb(), input()))
            }
          >
            {answerMode() ? 'Answer' : verb() === null ? 'Send' : 'Run'}
          </button>
        </form>
        {/* alpha.20 — verb hint row removed at user request. Placeholder
            text inside the input already cues the next action; the
            duplicate hint chip below the input was noise. */}
      </div>
      <div class="topbar-status">
        <Show when={props.project} fallback={<span class="topbar-placeholder">project: …</span>}>
          <span>{props.project!.name}</span>
        </Show>
        <span class="topbar-sep">·</span>
        <Show
          when={props.milestone}
          fallback={<span class="topbar-placeholder">milestone: …</span>}
        >
          <span>{props.milestone!.name}</span>
        </Show>
        <span class="topbar-sep">·</span>
        <Show
          when={props.milestone && props.milestone.phase_count > 0}
          fallback={
            <Show
              when={props.milestone}
              fallback={<span class="topbar-placeholder">phase: …</span>}
            >
              <span class="topbar-placeholder">no phases yet</span>
            </Show>
          }
        >
          <span>
            phase {props.milestone!.phase_index} of {props.milestone!.phase_count}
          </span>
        </Show>
      </div>
      <div class="topbar-controls">
        {/* alpha.20 — `backend: pi` chip removed at user request. SWT
            only has one backend today, so the label was redundant.
            Restore (with BACKEND_LABEL kept for that path) when a
            second backend ships. */}
        <span class="connection-pill" data-state={props.connection}>
          {PILL_LABEL[props.connection]}
        </span>
        <Show when={props.providerSection}>
          <div class="provider-menu-wrapper">
            <button
              type="button"
              class="provider-menu-trigger"
              ref={providerTriggerRef}
              aria-haspopup="menu"
              aria-expanded={providerMenuOpen()}
              onClick={() => toggleProviderMenu()}
            >
              Provider ▾
            </button>
            <ProviderMenu open={providerMenuOpen()} onClose={closeProviderMenu}>
              {props.providerSection}
            </ProviderMenu>
          </div>
        </Show>
        <div class="options-menu-wrapper">
          <button
            type="button"
            class="options-menu-trigger"
            ref={triggerRef}
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            onClick={() => toggleMenu()}
          >
            Options ▾
          </button>
          <OptionsMenu
            open={menuOpen()}
            onClose={closeMenu}
            commandsSection={props.commandsSection}
            settingsSection={props.settingsSection}
            data={props.optionsMenuConfigData ?? null}
            loading={props.optionsMenuConfigLoading ?? false}
            error={props.optionsMenuConfigError ?? null}
            lastFetched={props.optionsMenuConfigLastFetched ?? null}
            onRefresh={props.onOptionsMenuRefreshConfig}
            onSave={props.onOptionsMenuSaveConfig}
          />
        </div>
      </div>
    </header>
  );
};
