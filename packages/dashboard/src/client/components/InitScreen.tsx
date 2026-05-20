import type { ProviderAuthSnapshot, ProviderAuthStatus } from '@swt-labs/shared';
import {
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type Component,
} from 'solid-js';

import type { InitBody } from '../services/api.js';
import type { InitSessionState } from '../state/dashboard-store.js';

/**
 * Plan 19-04-01 T01 — pure helper computing the Initialize-button
 * enabled/disabled status from a ProviderAuthStatus row. 'green' iff the
 * credential is configured AND has a known auth mode (api_key or oauth) —
 * adapted from the brief's assumed `status === 'authed'` to the actual
 * schema per Phase 04 research P1 (no 'authed'|'missing'|'expired' string
 * field exists in ProviderAuthStatusSchema). 'red' otherwise. 'empty' for
 * null — no credentials configured at all OR no provider selected globally.
 *
 * Post-alpha.34 simplification: the InitScreen no longer renders a local
 * provider selector — provider selection happens exclusively via the
 * TopBar Provider menu (single source of truth). This helper now drives
 * only the Initialize-button enabled state, not a local status-indicator
 * button. The local dropdown was buggy (multiple "Keychain"-labeled
 * entries when more than one provider had keychain creds, and it could
 * default to a non-authed provider — see commit history).
 *
 * Milestone 23 Phase 02 T01 carry-over: still exported as a dead utility
 * for the existing `init-screen-helpers.test.ts` import; T02 either
 * deletes both the export AND the test, or keeps both. T01 leaves the
 * function in place to keep the diff minimal.
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
 * testing in init-screen-helpers.test.ts. Milestone 23 Phase 02 T01: the
 * synchronous scaffold no longer emits these trace lines, so this helper
 * is dead code in production for the new wizard — kept as a pure export
 * so its test continues to compile (Drift 4 resolution from Plan Notes).
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

/**
 * Milestone 23 Phase 02 T01 — pure step-gate helper. Step 1's
 * `[Continue →]` button is disabled ONLY when name is empty (Locked
 * Decision #10 — vendor-agnostic invariant; no provider check). Trimmed
 * length > 0 is the only condition.
 */
export function isStep1Complete(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * Milestone 23 Phase 02 T01 — pure builder. Assembles the `InitBody`
 * payload from the 4 wizard signals. Trims name + description; omits the
 * `description` field entirely when the trimmed string is empty (so the
 * server's optional-string path applies). `planning_tracking` and
 * `auto_push` are forwarded literally; Phase 01's `InitBodySchema`
 * accepts the Zod input shape with these as required-with-default fields.
 */
export function buildInitBody(args: {
  name: string;
  description: string;
  planningTracking: 'manual' | 'ignore' | 'commit';
  autoPush: 'never' | 'after_phase' | 'always';
}): InitBody {
  const name = args.name.trim();
  const description = args.description.trim();
  const body: InitBody = {
    name,
    planning_tracking: args.planningTracking,
    auto_push: args.autoPush,
  };
  if (description.length > 0) body.description = description;
  return body;
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
   * Accessor for the provider-auth snapshot. Used only to gate the
   * Initialize button on whether the GLOBALLY-selected provider
   * (snapshot.selected_provider, set via the TopBar Provider menu) has
   * valid credentials. Returns null while the tools cell is still loading
   * on first paint; the gate treats null as empty-state (button disabled).
   *
   * Post-alpha.34: InitScreen no longer owns a local provider selector.
   * Provider selection is exclusively the TopBar's responsibility; this
   * snapshot is read-only here.
   *
   * Milestone 23 Phase 02 T01 carry-over: the prop is still in the
   * interface for T01 (smaller diff). T02 removes it entirely along with
   * the gate logic (Locked Decision #10 — wizard is vendor-agnostic).
   */
  providerAuth: () => ProviderAuthSnapshot | null;
}

export const InitScreen: Component<InitScreenProps> = (props) => {
  // ── Wizard state machine ─────────────────────────────────────────────
  // Milestone 23 Phase 02 T01 — single local step signal driving the
  // 4-step flow: identity → config → progress → complete. No store
  // state; per proposal decision #12, wizard navigation is local
  // component state.
  const [step, setStep] = createSignal<1 | 2 | 3 | 4>(1);

  // ── Step 1 (identity) ─────────────────────────────────────────────────
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');

  // ── Step 2 (config) ───────────────────────────────────────────────────
  // Defaults match Phase 01's `InitBodySchema` Zod defaults so wizard +
  // server agree even when the user accepts the defaults without clicking.
  const [planningTracking, setPlanningTracking] = createSignal<'manual' | 'ignore' | 'commit'>(
    'manual',
  );
  const [autoPush, setAutoPush] = createSignal<'never' | 'after_phase' | 'always'>('never');

  // ── Submit / error state ──────────────────────────────────────────────
  const [error, setError] = createSignal<string | null>(null);

  // Plan 03-01 T3 — the form is disabled while either the scaffold POST
  // is in flight (props.submitting from initSubmitting) OR the init Lead
  // is running on the daemon (initSession.status === 'detecting'). With
  // milestone 23's synchronous scaffold, `detecting` is a sub-second
  // flash. Retained per Drift 6 — same prop contract still applies.
  const isBusy = (): boolean => props.submitting || props.initSession()?.status === 'detecting';

  // Plan 19-03-01 T02 — elapsed-counter signal driving the "(Ns)" suffix
  // on the live progress block. Retained as-is for T01; Step 3 (T03)
  // continues to reuse this if the brief progress flash is visible.
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

  // Post-alpha.34 / Milestone 23 Phase 02 T01 carry-over: the provider
  // gate. T02 removes this block entirely along with the `providerAuth`
  // prop (Locked Decision #10 — wizard is vendor-agnostic).
  const selectedCredential = createMemo<ProviderAuthStatus | null>(() => {
    const snapshot = props.providerAuth();
    if (!snapshot) return null;
    const id = snapshot.selected_provider;
    if (id === null) return null;
    return snapshot.statuses.find((s) => s.provider === id) ?? null;
  });

  const providerStatus = createMemo<'green' | 'red' | 'empty'>(() =>
    computeProviderStatus(selectedCredential()),
  );

  // TODO(T02): remove with provider-gate purge. Currently retained so
  // the [Continue →] button can still be visually disabled when the
  // provider is not authed — but per Locked Decision #10 the gate must
  // be DELETED in T02 and [Continue →] becomes name-only.
  const providerGateBlocked = (): boolean => providerStatus() !== 'green';

  // ── Submit handler (T01 placeholder — T03 finalises with response capture) ──
  // For T01 the submit just advances the wizard to Step 3 (placeholder).
  // T03 will wire the actual POST /api/init through props.onInit + capture
  // the response in lastInitResponse for Step 4's render.
  const handleSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (isBusy()) return;
    if (!isStep1Complete(name())) {
      setError('Project name is required.');
      setStep(1);
      return;
    }
    setError(null);
    // T01 placeholder: just advance to the Step 3 view. T03 replaces
    // this with `await props.onInit(buildInitBody({...}))` + response
    // capture + Step 4 transition + 409/5xx error handling.
    setStep(3);
  };

  // ── Step 1 helpers ────────────────────────────────────────────────────
  const goToStep2 = (): void => {
    if (!isStep1Complete(name())) {
      setError('Project name is required.');
      return;
    }
    setError(null);
    setStep(2);
  };

  return (
    <div
      class="init-screen init-wizard"
      data-variant={props.brownfield ? 'brownfield' : 'greenfield'}
      data-step={step()}
      role="dialog"
      aria-label="Initialize SWT project"
    >
      <div class="init-wizard-shell">
        <div class="init-wizard-header">
          <h1 class="init-wizard-title">
            <span class="topbar-brand-mark">swt</span>
            <span class="topbar-brand-cursor">_</span>
          </h1>
          <ol class="init-wizard-stepper" aria-label="Wizard progress">
            <li class="init-wizard-step" data-active={step() === 1} data-done={step() > 1}>
              <span class="init-wizard-step-num">1</span>
              <span class="init-wizard-step-label">Identity</span>
            </li>
            <li class="init-wizard-step" data-active={step() === 2} data-done={step() > 2}>
              <span class="init-wizard-step-num">2</span>
              <span class="init-wizard-step-label">Config</span>
            </li>
            <li class="init-wizard-step" data-active={step() === 3} data-done={step() > 3}>
              <span class="init-wizard-step-num">3</span>
              <span class="init-wizard-step-label">Scaffold</span>
            </li>
            <li class="init-wizard-step" data-active={step() === 4} data-done={false}>
              <span class="init-wizard-step-num">4</span>
              <span class="init-wizard-step-label">Done</span>
            </li>
          </ol>
        </div>

        <Switch>
          {/* ── Step 1 — Identity ────────────────────────────────────── */}
          <Match when={step() === 1}>
            <section class="init-wizard-step-panel" aria-labelledby="init-step1-heading">
              <h2 id="init-step1-heading" class="init-wizard-step-heading">
                {props.brownfield ? 'Set up SWT around your project' : 'Name your project'}
              </h2>
              <p class="init-wizard-lede">
                {props.brownfield
                  ? 'No .swt-planning/ here yet — but plenty of code. SWT scaffolds its planning artifacts alongside your existing files. Nothing changes until an agent makes an edit you approve.'
                  : 'No .swt-planning/ here yet. Pick a name to scaffold one. SWT runs the methodology loop while you describe what you want.'}
              </p>

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

              <Show when={error()}>
                <p class="init-error">{error()}</p>
              </Show>

              <div class="init-wizard-actions">
                <button
                  type="button"
                  class="init-submit init-wizard-primary"
                  disabled={!isStep1Complete(name())}
                  onClick={goToStep2}
                >
                  Continue →
                </button>
              </div>
            </section>
          </Match>

          {/* ── Step 2 — Config ──────────────────────────────────────── */}
          <Match when={step() === 2}>
            <section class="init-wizard-step-panel" aria-labelledby="init-step2-heading">
              <h2 id="init-step2-heading" class="init-wizard-step-heading">
                Configure scaffolding
              </h2>
              <p class="init-wizard-lede">
                These map straight onto <code>.swt-planning/config.json</code>. You can change them
                later via the Settings dropdown.
              </p>

              <fieldset class="init-wizard-radio-group">
                <legend>Planning tracking</legend>
                <p class="init-wizard-hint">
                  How <code>.swt-planning/</code> appears in git.
                </p>
                {(['manual', 'ignore', 'commit'] as const).map((value) => (
                  <label class="init-wizard-radio">
                    <input
                      type="radio"
                      name="planning_tracking"
                      value={value}
                      checked={planningTracking() === value}
                      onChange={() => setPlanningTracking(value)}
                    />
                    <span class="init-wizard-radio-label">
                      <strong>{value}</strong>
                      <span class="init-wizard-radio-desc">
                        {value === 'manual'
                          ? 'Gitignored as a whole; opt in by uncommenting (default).'
                          : value === 'ignore'
                            ? 'Always gitignored; no opt-in carve-outs.'
                            : 'Track PROJECT.md / STATE.md / config.json; runtime files stay ignored.'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <fieldset class="init-wizard-radio-group">
                <legend>Auto-push</legend>
                <p class="init-wizard-hint">When should SWT push commits to origin?</p>
                {(['never', 'after_phase', 'always'] as const).map((value) => (
                  <label class="init-wizard-radio">
                    <input
                      type="radio"
                      name="auto_push"
                      value={value}
                      checked={autoPush() === value}
                      onChange={() => setAutoPush(value)}
                    />
                    <span class="init-wizard-radio-label">
                      <strong>{value}</strong>
                      <span class="init-wizard-radio-desc">
                        {value === 'never'
                          ? 'Local only — you push manually (default).'
                          : value === 'after_phase'
                            ? 'Push after each completed phase.'
                            : 'Push after every successful commit.'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <Show when={error()}>
                <p class="init-error">{error()}</p>
              </Show>

              <div class="init-wizard-actions">
                <button
                  type="button"
                  class="init-wizard-secondary"
                  disabled={isBusy()}
                  onClick={() => setStep(1)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  class="init-submit init-wizard-primary"
                  disabled={isBusy() || providerGateBlocked()}
                  onClick={(e) => void handleSubmit(e)}
                >
                  Initialize SWT →
                </button>
              </div>
            </section>
          </Match>

          {/* ── Step 3 — Scaffold progress (T01 placeholder) ─────────── */}
          <Match when={step() === 3}>
            <section class="init-wizard-step-panel init-wizard-progress" aria-live="polite">
              <h2 class="init-wizard-step-heading">Scaffolding…</h2>
              <p class="init-wizard-lede">
                ◆ Writing <code>.swt-planning/</code> · {elapsed()}s
              </p>
            </section>
          </Match>

          {/* ── Step 4 — Complete (T01 placeholder) ──────────────────── */}
          <Match when={step() === 4}>
            <section class="init-wizard-step-panel init-wizard-complete">
              <h2 class="init-wizard-step-heading">Complete.</h2>
              <p class="init-wizard-lede">SWT is initialized. Dashboard takes over shortly.</p>
            </section>
          </Match>
        </Switch>
      </div>
    </div>
  );
};
