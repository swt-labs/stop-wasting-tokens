import type { Backend, MilestoneSummary, ProjectSummary } from '@swt-labs/shared';
import { Show, createMemo, createSignal, type Component } from 'solid-js';

import type { ConnectionState } from '../state/dashboard-store.js';
import { OptionsMenu } from './OptionsMenu.js';

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

// Mirrors packages/dashboard/src/server/lib/allowed-verbs.ts. Kept in sync by
// hand because the SPA bundle ships separately from the dashboard server bundle
// per tsup.config.ts; a runtime import would couple the build graphs.
const ALLOWLIST = new Set(['help', 'version', 'status', 'doctor', 'detect-phase', 'update']);
const INTERACTIVE = new Set(['vibe', 'watch', 'dashboard']);

type VerbStatus = 'empty' | 'literal' | 'interactive' | 'unknown' | 'natural_language';

/**
 * Decides whether unknown input looks like natural language (route to vibe)
 * vs a typo of a literal verb (suggest the allowlist). Heuristic:
 *   - 3+ tokens → treat as natural language. "build me a snake game" matches.
 *   - first token has 8+ chars → treat as natural language. "describe …" matches.
 *   - otherwise → unknown verb (typo). "stauts" suggests "status".
 *
 * Conservative on the natural-language side — false positives route to vibe
 * which spawns an agent (cost). False negatives show the allowlist hint
 * which is recoverable. We tune toward fewer false positives.
 */
function looksLikeNaturalLanguage(trimmed: string): boolean {
  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 3) return true;
  const first = tokens[0] ?? '';
  return first.length >= 8;
}

function classifyInput(input: string): VerbStatus {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 'empty';
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (ALLOWLIST.has(firstToken)) return 'literal';
  if (INTERACTIVE.has(firstToken)) return 'interactive';
  if (looksLikeNaturalLanguage(trimmed)) return 'natural_language';
  return 'unknown';
}

export const TopBar: Component<TopBarProps> = (props) => {
  const [input, setInput] = createSignal('');
  const status = createMemo<VerbStatus>(() => classifyInput(input()));

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

  const onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const value = input().trim();
    if (value.length === 0) return;
    setInput('');
    if (status() === 'natural_language') {
      await props.onVibe(value);
      return;
    }
    await props.onCommand(value);
  };

  return (
    <header class="topbar" role="banner">
      <h1 class="topbar-brand">
        <span class="topbar-brand-mark">swt</span>
        <span class="topbar-brand-cursor">_</span>
      </h1>
      <div class="topbar-cmd-wrapper">
        <form class="topbar-cmd" onSubmit={(e) => void onSubmit(e)} aria-label="Run swt command">
          <span class="topbar-cmd-prompt">$</span>
          <input
            type="text"
            class="topbar-cmd-input"
            placeholder="Describe what you want to build, or run: status / doctor / help / version …"
            autocomplete="off"
            spellcheck={false}
            disabled={props.commandSubmitting || props.vibeStarting}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
          />
        </form>
        <Show
          when={
            status() === 'natural_language' || status() === 'unknown' || status() === 'interactive'
          }
        >
          <div class="topbar-cmd-hint-row">
            <Show when={status() === 'natural_language'}>
              <span class="topbar-cmd-hint" data-hint="natural" role="status">
                ↵ Press enter to start a vibe session
              </span>
            </Show>
            <Show when={status() === 'unknown'}>
              <span class="topbar-cmd-hint" data-hint="unknown" role="status">
                ↪ Try: status, doctor, help, detect-phase, version, update
              </span>
            </Show>
            <Show when={status() === 'interactive'}>
              <span class="topbar-cmd-hint" data-hint="interactive" role="status">
                ↪ Interactive — run from your terminal
              </span>
            </Show>
          </div>
        </Show>
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
          <OptionsMenu open={menuOpen()} onClose={closeMenu} />
        </div>
      </div>
    </header>
  );
};
