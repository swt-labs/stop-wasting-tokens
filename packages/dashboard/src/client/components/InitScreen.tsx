import type {
  ProviderAuthMode,
  ProviderAuthSnapshot,
  ProviderAuthStatus,
  ProviderAuthUpdateBody,
} from '@swt-labs/shared';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
} from 'solid-js';

import type { InitBody } from '../services/api.js';
import type { InitSessionState } from '../state/dashboard-store.js';

/**
 * Plan 19-04-01 T01 — pure helper for InitScreen's provider dropdown default
 * selection. Chain: first match by provider-id from snapshot.selected_provider
 * → first authed credential (configured && mode !== null) → first overall
 * → null. The brief assumed a `provider:mode` composite for matching, but
 * Phase 04 research P4 confirmed selected_provider is provider-id-only
 * (a single string like "anthropic"). Match by provider id.
 */
export function selectInitialProvider(
  statuses: readonly ProviderAuthStatus[],
  selectedProviderFromSnapshot: string | null,
): ProviderAuthStatus | null {
  if (statuses.length === 0) return null;
  if (selectedProviderFromSnapshot !== null) {
    const match = statuses.find((s) => s.provider === selectedProviderFromSnapshot);
    if (match) return match;
  }
  const authed = statuses.find((s) => s.configured && s.mode !== null);
  return authed ?? statuses[0] ?? null;
}

/**
 * Plan 19-04-01 T01 — pure helper computing the InitScreen status-indicator
 * color from a ProviderAuthStatus row. 'green' iff the credential is
 * configured AND has a known auth mode (api_key or oauth) — adapted from
 * the brief's assumed `status === 'authed'` to the actual schema per
 * Phase 04 research P1 (no 'authed'|'missing'|'expired' string field
 * exists in ProviderAuthStatusSchema). 'red' otherwise. 'empty' for null
 * — the empty-state placeholder branch (no credentials configured at all).
 */
export function computeProviderStatus(
  credential: ProviderAuthStatus | null,
): 'green' | 'red' | 'empty' {
  if (credential === null) return 'empty';
  return credential.configured && credential.mode !== null ? 'green' : 'red';
}

/**
 * Plan 19-03-01 T02 — friendly-label map for `[tool] X` lines coming out
 * of the Phase 01 trace sink. The toolset is the small fixed set Pi
 * exposes (Read, Grep, Glob, Write, Edit, Bash). Unknown tools fall
 * through to a generic "using tool…" label so the renderer never blanks
 * out. Inlined here (not extracted into a util file) because the map is
 * tiny and the helper has exactly one call site: classifyInitLine below.
 */
function toolFriendlyLabel(tool: string): string {
  switch (tool) {
    case 'Read':
      return 'reading project files…';
    case 'Grep':
      return 'searching project files…';
    case 'Glob':
      return 'listing project files…';
    case 'Write':
      return 'writing files…';
    case 'Edit':
      return 'editing files…';
    case 'Bash':
      return 'running shell command…';
    default:
      return 'using tool…';
  }
}

/**
 * Plan 19-03-01 T02 — classify a raw `log.append` line into a friendly
 * progress label for the live status block above the Initialize button.
 *
 * Truth table (brief §G):
 *   - `[tool] X`                  → `{friendly} (X)` via toolFriendlyLabel
 *   - `[llm turn N] <text>`       → `thinking… "<first 80 chars[…]>"`
 *   - `✓ Initialized .swt-planning/` → `wrote .swt-planning/`
 *   - `→ Spawning Lead`           → `spawning Lead (commands/init.md)…`
 *   - `✓ Lead bootstrap complete` → `bootstrap complete, finalizing…`
 *   - undefined / empty string    → `detecting stack…`
 *   - anything else               → render raw (defensive fallback)
 *
 * Pure function: no Solid primitives, no side effects. Exported for unit
 * testing in init-screen-helpers.test.ts (Phase 04 will extend that file
 * for provider helpers).
 */
export function classifyInitLine(line: string | undefined): string {
  if (!line) return 'detecting stack…';
  if (line.startsWith('[tool] ')) {
    const tool = line.slice(7).trim();
    return `${toolFriendlyLabel(tool)} (${tool})`;
  }
  if (line.startsWith('[llm turn ')) {
    const close = line.indexOf(']');
    const text = close > 0 ? line.slice(close + 2).trim() : line;
    const snippet = text.length > 80 ? text.slice(0, 80) + '…' : text;
    return `thinking… "${snippet}"`;
  }
  if (line.startsWith('✓ Initialized .swt-planning/')) return 'wrote .swt-planning/';
  if (line.startsWith('→ Spawning Lead')) return 'spawning Lead (commands/init.md)…';
  if (line.startsWith('✓ Lead bootstrap complete')) return 'bootstrap complete, finalizing…';
  return line;
}

export interface InitScreenProps {
  submitting: boolean;
  /**
   * True when the daemon detected source files in cwd but no
   * `.swt-planning/` — the user is dropping SWT into an existing project.
   * Drives the headline + step copy + CTA wording.
   */
  brownfield: boolean;
  /**
   * Plan 03-01 T3 — the in-flight init Lead lifecycle, or `null` when no
   * init is running. Drives the in-button status label when
   * `status === 'detecting'` and the error paragraph fallback when
   * `status === 'error'` (surfaces `errorMessage`). Accessor pattern
   * (same shape App.tsx uses for `agents` / `sessionId` props on other
   * panes) so Solid's reactivity tracks store mutations.
   */
  initSession: () => InitSessionState | null;
  onInit: (body: InitBody) => Promise<void>;
  /**
   * Plan 19-04-01 T01 — accessor for the provider-auth snapshot driving
   * the dropdown + status indicator. Returns null while the tools cell is
   * still loading on first paint; the dropdown + status indicator
   * suppress rendering in that case (treat as empty-state). Mirrors the
   * `initSession` accessor pattern at L84 for Solid reactivity tracking.
   */
  providerAuth: () => ProviderAuthSnapshot | null;
  /**
   * Plan 19-04-01 T01 — invoked on <select> change. Wraps the same
   * `actions.applyProviderAuthUpdate` the TopBar ProviderAuthPanel uses
   * (zero duplicated auth UI). Re-selecting an already-configured
   * api_key credential omits `apiKey` to preserve the existing keychain
   * entry, per ProviderAuthUpdateBodySchema docstring (api.ts:391-397).
   */
  onSelectProvider: (body: ProviderAuthUpdateBody) => Promise<{ ok: true } | { error: string }>;
  /**
   * Plan 19-04-01 T01 — invoked on status-indicator click + empty-state
   * button click. Same dispatcher TopBar Provider menu uses
   * (Decision #19 / AC-21).
   */
  onOpenProviderMenu: () => void;
}

interface Step {
  title: string;
  body: string;
}

const GREENFIELD_STEPS: ReadonlyArray<Step> = [
  {
    title: 'Name your project',
    body: 'Pick a slug — anything kebab-case works. SWT scaffolds .swt-planning/ next to where you ran the dashboard.',
  },
  {
    title: 'Describe what you want',
    body: 'Once initialized, type your idea in the command bar above. The agent will ask follow-up questions if anything is unclear.',
  },
  {
    title: 'Review and ship',
    body: 'Watch agents work in the timeline on the right. Files appear in your project. Commit when it looks good.',
  },
];

const BROWNFIELD_STEPS: ReadonlyArray<Step> = [
  {
    title: 'Name the existing project',
    body: 'We see you have a codebase here already. Pick a slug for SWT to use — your existing files stay untouched.',
  },
  {
    title: 'Describe what you want changed',
    body: 'Once initialized, type your goal in the command bar above. The agent maps your codebase first, then plans the change.',
  },
  {
    title: 'Review and ship',
    body: 'Watch agents work in the timeline on the right. Diffs land in your project. Commit when it looks good.',
  },
];

export const InitScreen: Component<InitScreenProps> = (props) => {
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  // Plan 03-01 T3 — the form is disabled while either the scaffold POST
  // is in flight (props.submitting from initSubmitting) OR the init Lead
  // is running on the daemon (initSession.status === 'detecting'). Combined
  // so the inputs + submit button stay locked from form-submit through
  // init.complete / init.error.
  const isBusy = (): boolean => props.submitting || props.initSession()?.status === 'detecting';

  // Plan 19-03-01 T02 — elapsed-counter signal driving the "(Ns)" suffix
  // on the live progress block. tick() is a millisecond timestamp the
  // interval refreshes every 1s; elapsed() derives a seconds-since-start
  // from initSession.started_at. The setInterval body guards on isBusy()
  // so it short-circuits after init.complete (initSession=null) and
  // init.error (status='error'); onCleanup tears the interval down on
  // InitScreen unmount (AC-3, AC-4, AC-5).
  const [tick, setTick] = createSignal<number>(Date.now());
  onMount(() => {
    const id = setInterval(() => {
      if (isBusy()) setTick(Date.now());
    }, 1000);
    onCleanup(() => clearInterval(id));
  });
  const elapsed = createMemo<number>(() => {
    const startedAt = props.initSession()?.started_at;
    if (!startedAt) return 0;
    return Math.floor((tick() - new Date(startedAt).getTime()) / 1000);
  });

  // Plan 19-03-01 T02 — displayLabel combines the classifier with the
  // >120s long-running fallback (Decision #10). Solid's createMemo means
  // this recomputes whenever either upstream signal changes (tick() for
  // the elapsed crossing, props.initSession() for the lastMessage feed).
  const displayLabel = createMemo<string>(() => {
    if (elapsed() > 120) return 'still working — large repos can take 3-5 min on first run';
    return classifyInitLine(props.initSession()?.lastMessage);
  });

  // Plan 19-04-01 T01 — provider selector state. The "selected provider id"
  // is a local signal that initializes from selectInitialProvider() over the
  // current snapshot. We let the user override it via the <select>'s
  // onChange, AND we re-sync it whenever the snapshot's selected_provider
  // changes (SSE state.changed from another surface like TopBar Provider
  // menu). The two surfaces stay in sync because both ultimately read from
  // state.tools.providerAuth.snapshot.selected_provider — AC-23.
  const statuses = (): readonly ProviderAuthStatus[] => props.providerAuth()?.statuses ?? [];

  const initialSelection = createMemo<ProviderAuthStatus | null>(() =>
    selectInitialProvider(statuses(), props.providerAuth()?.selected_provider ?? null),
  );

  const [selectedProviderId, setSelectedProviderId] = createSignal<string | null>(
    initialSelection()?.provider ?? null,
  );

  // Re-sync the local signal whenever the snapshot's selected_provider
  // changes from out-of-band (e.g. TopBar Provider menu save). createEffect
  // fires when its tracked reads change; we only WRITE when the server-side
  // selected_provider differs from the local id (avoids feedback loop on
  // our own writes — applyProviderAuthUpdate optimistically updates the
  // cell which would otherwise re-trigger).
  createEffect(() => {
    const fromSnapshot = props.providerAuth()?.selected_provider ?? null;
    if (fromSnapshot !== null && fromSnapshot !== selectedProviderId()) {
      setSelectedProviderId(fromSnapshot);
    }
  });

  // Resolve the currently-selected ProviderAuthStatus row by id. May be null
  // if the snapshot is empty or the id resolved to a now-removed credential.
  const selectedCredential = createMemo<ProviderAuthStatus | null>(() => {
    const id = selectedProviderId();
    if (id === null) return null;
    return statuses().find((s) => s.provider === id) ?? null;
  });

  const providerStatus = createMemo<'green' | 'red' | 'empty'>(() =>
    computeProviderStatus(selectedCredential()),
  );

  // AC-22 / AC-24: Initialize disabled when not green OR no credentials at all
  // OR the existing isBusy() condition.
  const providerGateBlocked = (): boolean => providerStatus() !== 'green';

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Belt-and-suspenders against double-fire on rapid clicks. The button is
    // also disabled via isBusy(), but the form itself can still submit on
    // Enter when focus is in the textarea, so guard here too. Phase 04 adds
    // the provider-gate condition (defense-in-depth against keyboard submit
    // when the button is visually disabled but the form still accepts Enter).
    if (isBusy() || providerGateBlocked()) return;
    const trimmedName = name().trim();
    if (trimmedName.length === 0) {
      setError('Project name is required.');
      return;
    }
    setError(null);
    const trimmedDesc = description().trim();
    try {
      await props.onInit({
        name: trimmedName,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const headline = (): string =>
    props.brownfield ? 'Set up SWT around your existing project' : 'Welcome to SWT';

  const lede = (): string =>
    props.brownfield
      ? 'No .swt-planning/ here yet — but plenty of code. SWT will scaffold its planning artifacts alongside your existing files. Nothing in your project changes until an agent makes an explicit edit you approve.'
      : 'No .swt-planning/ here yet. Name your project to scaffold one. SWT runs the methodology loop while you describe what you want in plain English.';

  const steps = (): ReadonlyArray<Step> => (props.brownfield ? BROWNFIELD_STEPS : GREENFIELD_STEPS);

  const submitLabel = (): string => {
    // Plan 03-01 T3 — surface the Lead-running state inline on the submit
    // button. Keeps visual scope minimal: a single in-button label, no
    // modal/spinner component. Submit-time + Lead-running are both
    // surfaced through the same gate (isBusy) so the label flow is:
    //   idle → "✓ Initialize…" → "◆ Initializing…" → detecting-state
    //   → unmount (on init.complete).
    if (props.initSession()?.status === 'detecting') return '◆ Detecting stack…';
    if (props.submitting) return '◆ Initializing…';
    return props.brownfield ? '✓ Initialize SWT for this codebase' : '✓ Initialize SWT project';
  };

  return (
    <div
      class="init-screen"
      data-variant={props.brownfield ? 'brownfield' : 'greenfield'}
      role="dialog"
      aria-label="Initialize SWT project"
    >
      <div class="init-card init-card-split">
        <aside class="init-explainer">
          <h1 class="init-title">
            <span class="topbar-brand-mark">swt</span>
            <span class="topbar-brand-cursor">_</span>
          </h1>
          <p class="init-headline">{headline()}</p>
          <ol class="init-steps">
            {steps().map((step, idx) => (
              <li class="init-step">
                <div class="init-step-number">{idx + 1}</div>
                <div class="init-step-content">
                  <div class="init-step-title">{step.title}</div>
                  <div class="init-step-body">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <form class="init-form" onSubmit={(e) => void submit(e)}>
          <p class="init-lede">{lede()}</p>

          {/*
           * Plan 19-04-01 T01 — Provider selector + auth-status indicator above the
           * PROJECT NAME field (brief §I + ACs 18-24). Two render branches:
           *   1) statuses().length === 0  → empty-state placeholder (.provider-empty)
           *   2) statuses().length >= 1   → dropdown + status button (.provider-selector)
           * Both branches dispatch actions.openProviderMenu via props.onOpenProviderMenu
           * for the auth-management click target — zero duplicated auth UI (Decision #19).
           */}
          <Show
            when={statuses().length > 0}
            fallback={
              <div class="provider-empty">
                <span>No providers configured —</span>
                <button
                  type="button"
                  class="provider-empty-link"
                  onClick={() => props.onOpenProviderMenu()}
                >
                  open the Provider menu →
                </button>
              </div>
            }
          >
            <label class="init-field provider-selector-field">
              <span>Provider</span>
              <div class="provider-selector">
                <select
                  class="init-input provider-select"
                  value={selectedProviderId() ?? ''}
                  disabled={isBusy()}
                  onChange={(e): void => {
                    const nextProvider = e.currentTarget.value;
                    setSelectedProviderId(nextProvider);
                    const cred = statuses().find((s) => s.provider === nextProvider);
                    // ProviderAuthUpdateBody requires authMode. Use the credential's
                    // existing mode when known; default to 'api_key' (lowest-friction
                    // mode) when the credential has mode === null. apiKey is OMITTED
                    // — re-selecting preserves the existing keychain entry per
                    // ProviderAuthUpdateBodySchema docstring (api.ts:391-397).
                    const authMode: ProviderAuthMode = cred?.mode ?? 'api_key';
                    void props.onSelectProvider({ provider: nextProvider, authMode });
                  }}
                >
                  <For each={statuses()}>
                    {(s): JSX.Element => (
                      <option value={s.provider}>
                        {s.label ?? s.provider} ({s.mode ?? 'no mode'})
                      </option>
                    )}
                  </For>
                </select>
                <button
                  type="button"
                  class={`provider-status provider-status--${providerStatus() === 'green' ? 'ok' : 'missing'}`}
                  title={
                    providerStatus() === 'green'
                      ? `${selectedCredential()?.label ?? selectedCredential()?.provider ?? 'Provider'} credentials are valid · click to manage`
                      : `${selectedCredential()?.label ?? selectedCredential()?.provider ?? 'Provider'} needs credentials · click to add them`
                  }
                  aria-label={
                    providerStatus() === 'green'
                      ? 'Provider credentials valid; open Provider menu'
                      : 'Provider credentials missing; open Provider menu'
                  }
                  onClick={() => props.onOpenProviderMenu()}
                >
                  {providerStatus() === 'green' ? '✓' : '✗'}
                </button>
              </div>
            </label>
          </Show>

          <label class="init-field">
            <span>Project name</span>
            <input
              type="text"
              class="init-input"
              placeholder={props.brownfield ? 'my-existing-project' : 'my-swt-project'}
              autocomplete="off"
              spellcheck={false}
              disabled={isBusy()}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              autofocus
            />
          </label>

          <label class="init-field">
            <span>Description (optional)</span>
            <textarea
              class="init-textarea"
              placeholder="One or two sentences about what this project does."
              disabled={isBusy()}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </label>

          {/*
           * Plan 03-01 T3 — surface either the local form-validation error
           * (createSignal `error`) OR an init.error SSE event's
           * `errorMessage` through the same existing paragraph. No new
           * toast component; `state.errors` is also pushed to in the
           * store, but is currently unrendered, so this paragraph is the
           * user-visible surface for init failures. The accessor read
           * order means a local error (e.g. "Project name is required.")
           * still wins when both are set, which matches the user's
           * mental model — their typo prompt is more recent than the
           * earlier Lead failure.
           */}
          <Show when={error() ?? props.initSession()?.errorMessage}>
            <p class="init-error">{error() ?? props.initSession()?.errorMessage}</p>
          </Show>

          {/*
           * Plan 19-03-01 T02 — live progress block. Renders only while
           * isBusy() is true, which means EITHER the scaffold POST is in
           * flight (no started_at yet — elapsed=0, label='detecting
           * stack…') OR the daemon-side Lead is running (status ===
           * 'detecting' — log.append reducer keeps lastMessage fresh).
           * Auto-hides on init.complete (InitScreen unmount via parent
           * is_initialized=true) AND on init.error (isBusy() flips false
           * because status === 'error'); never co-renders with
           * .init-error above (mutual exclusion via the isBusy() gate).
           * ARIA role='status' + aria-live='polite' announce updates to
           * screen readers without interrupting (AC-8).
           */}
          <Show when={isBusy()}>
            <div class="init-progress" role="status" aria-live="polite">
              ◆ {displayLabel()} ({elapsed()}s)
            </div>
          </Show>

          <div class="init-actions">
            <button
              type="submit"
              class="init-submit"
              disabled={isBusy() || providerGateBlocked()}
              title={
                providerGateBlocked() && !isBusy()
                  ? 'Provider credentials needed — click the red indicator to add them.'
                  : undefined
              }
            >
              {submitLabel()}
            </button>
          </div>

          <p class="init-fineprint">
            Creates <code>.swt-planning/PROJECT.md</code>, <code>.swt-planning/STATE.md</code>, and
            an empty <code>phases/</code> dir. The dashboard reconnects automatically.
          </p>
        </form>
      </div>
    </div>
  );
};
