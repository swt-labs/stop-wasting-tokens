import type { Backend, MilestoneSummary, ProjectSummary } from '@swt-labs/shared';
import { Show, createMemo, createSignal, For, type Component, type JSX } from 'solid-js';

import type { ConnectionState } from '../state/dashboard-store.js';

import { OptionsMenu } from './OptionsMenu.js';
import { ProviderMenu } from './ProviderMenu.js';

export interface TopBarProps {
  project: ProjectSummary | null;
  milestone: MilestoneSummary | null;
  connection: ConnectionState;
  commandSubmitting: boolean;
  vibeStarting: boolean;
  onCommand: (input: string) => Promise<unknown>;
  onVibe: (input: string) => Promise<unknown>;
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
   * Phase 2 (Dashboard Options Menu) — the Settings section content mounted
   * into OptionsMenu's `settingsSection` slot. Optional: when App.tsx does
   * not pass it, OptionsMenu falls back to its Phase-1 'Coming soon' skeleton.
   */
  settingsSection?: JSX.Element;
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

const BACKEND_LABEL: Record<Backend, string> = {
  pi: 'pi',
};

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
export function composeCommand(verb: string, input: string): ComposedCommand {
  const trimmed = input.trim();
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
export function canSubmit(verb: string, input: string): boolean {
  const entry = ACTION_VERBS.find((v) => v.value === verb);
  if (entry?.requiresInput) {
    return input.trim().length > 0;
  }
  return true;
}

/** Verb-aware hint text describing what pressing ↵ / Run will do. */
function hintForVerb(verb: string): string {
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

/** Verb-aware input placeholder. */
function placeholderForVerb(verb: string): string {
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
  // The selected verb is local TopBar UI state — not in the store, not
  // persisted (keep it simple, mirroring the `input` signal). cook default.
  const [verb, setVerb] = createSignal<string>('cook');

  const hint = createMemo(() => hintForVerb(verb()));
  const placeholder = createMemo(() => placeholderForVerb(verb()));

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
    const selectedVerb = verb();
    if (!canSubmit(selectedVerb, input())) return;
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

  const controlsDisabled = (): boolean => props.commandSubmitting || props.vibeStarting;

  return (
    <header class="topbar" role="banner">
      <h1 class="topbar-brand">
        <span class="topbar-brand-mark">swt</span>
        <span class="topbar-brand-cursor">_</span>
      </h1>
      <div class="topbar-cmd-wrapper">
        <form class="topbar-cmd" onSubmit={(e) => void onSubmit(e)} aria-label="Run swt command">
          <select
            class="topbar-cmd-verb"
            aria-label="Command"
            disabled={controlsDisabled()}
            value={verb()}
            onChange={(e) => setVerb(e.currentTarget.value)}
          >
            <For each={ACTION_VERBS}>{(v) => <option value={v.value}>{v.label}</option>}</For>
          </select>
          <span class="topbar-cmd-prompt">$</span>
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
            disabled={controlsDisabled() || !canSubmit(verb(), input())}
          >
            Run
          </button>
        </form>
        <div class="topbar-cmd-hint-row">
          <span class="topbar-cmd-hint" data-hint="verb" role="status">
            {hint()}
          </span>
        </div>
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
        <Show when={props.project}>
          <span class="topbar-pill">backend: {BACKEND_LABEL[props.project!.backend]}</span>
        </Show>
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
          />
        </div>
      </div>
    </header>
  );
};
