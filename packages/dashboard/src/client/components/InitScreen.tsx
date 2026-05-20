import { createResource, createSignal, Match, Show, Switch, type Component } from 'solid-js';

import { ApiError, fetchInitPrecheck } from '../services/api.js';
import type { InitBody, InitPrecheckResponse, InitResponse } from '../services/api.js';
import type { InitSessionState } from '../state/dashboard-store.js';

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
 * testing in init-screen-helpers.test.ts. Milestone 23 Phase 02: the
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

/**
 * Milestone 23 Phase 02 T02 — pure label for the Step 1 git-state line.
 * Maps the 3-value enum from `GET /api/init-precheck` to a one-line
 * human-readable string.
 */
export function describeGitState(git: 'absent' | 'repo' | 'parent_repo'): string {
  switch (git) {
    case 'absent':
      return 'No git repository (SWT will run `git init` for you)';
    case 'repo':
      return 'Git repository detected';
    case 'parent_repo':
      return 'Inside parent git repository';
  }
}

/**
 * Milestone 23 Phase 02 T02 — pure label for the Step 1 brownfield-vs-
 * greenfield line. Renders a "Brownfield (N source file{s} detected)"
 * string for brownfield projects (with singular/plural agreement) and a
 * static "Greenfield (no existing source files)" for fresh dirs.
 */
export function describePrecheckMode(brownfield: boolean, sourceFileCount: number): string {
  if (!brownfield) return 'Greenfield (no existing source files)';
  const noun = sourceFileCount === 1 ? 'source file' : 'source files';
  return `Brownfield (${sourceFileCount} ${noun} detected)`;
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
  /**
   * Milestone 23 Phase 02 T03 (Drift 5) — onInit now returns the parsed
   * `InitResponse` so the wizard's Step 4 can render from the HTTP
   * response (brownfield, git_initialized, stack, files) instead of
   * waiting for the SSE `init.complete` event (which fires
   * synchronously ~100ms later and clears state.initSession before
   * the wizard can read it).
   */
  onInit: (body: InitBody) => Promise<InitResponse>;
  /**
   * Milestone 23 Phase 03 (PA-1, PA-6) — Step 4's `[Map codebase]` button
   * reads this accessor (true while `swt map` is running on the daemon).
   * Hoisted from the former component-local `mapClicked` signal to the
   * dashboard store so the wizard + the persistent `<CodebaseMapPrompt>`
   * banner observe the SAME in-flight flag.
   */
  isMappingCodebase: () => boolean;
  /**
   * Milestone 23 Phase 03 (PA-1, PA-6) — Step 4's `[Map codebase]` button
   * onClick. Wired in App.tsx to `actions.startCodebaseMap()` (the store
   * action that calls `postMap()`).
   */
  onMapCodebase: () => void;
}

/**
 * Milestone 23 Phase 02 T03 — pure helper that classifies a submit
 * error into one of three categories so the wizard's UI can route to
 * the correct affordance. Mirrors the 409 / 5xx / network split the
 * Phase 01 `POST /api/init` route produces:
 *
 *   - `already-initialized` — HTTP 409. Server detected `.swt-planning/`
 *     already exists at submit time. Show the "go to dashboard"
 *     recovery affordance. Do not advance to Step 4.
 *   - `retryable` — HTTP 5xx or thrown network error. Show inline error
 *     + [Retry] button that re-invokes submit.
 *   - `fatal` — any other error (4xx other than 409, ZodError parse
 *     failure, etc.). Show inline error WITHOUT [Retry] (clicking
 *     again would deterministically fail again).
 *
 * The `ApiError` shape (from `services/api.ts`) carries the
 * `status: number` so we can branch reliably.
 */
export function classifyInitError(err: unknown): 'already-initialized' | 'retryable' | 'fatal' {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'already-initialized';
    if (err.status >= 500) return 'retryable';
    return 'fatal';
  }
  // Non-ApiError throwables — network failures, parse errors,
  // unexpected DOM exceptions. Treat as retryable so the user has an
  // affordance to recover.
  return 'retryable';
}

/**
 * Milestone 23 Phase 02 T03 — pure summary builder for the Step 4
 * completion view. Maps the InitResponse into a struct the JSX
 * consumes; extracted as a pure function so the snapshot is testable
 * in vitest node-env without rendering Solid components.
 */
export interface InitResponseSummary {
  modeLabel: string;
  gitInitializedLabel: string | null;
  stackLabel: string | null;
  fileCount: number;
  filesPreview: ReadonlyArray<string>;
}

export function summarizeInitResponse(response: InitResponse): InitResponseSummary {
  return {
    modeLabel: response.brownfield ? 'Mode: Brownfield' : 'Mode: Greenfield',
    gitInitializedLabel: response.git_initialized ? '✓ git repository initialized' : null,
    stackLabel: response.stack.length > 0 ? `Stack: ${response.stack.join(', ')}` : null,
    fileCount: response.files.length,
    // Cap at 5 entries to keep the panel compact for large file lists.
    filesPreview: response.files.slice(0, 5),
  };
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

  // Milestone 23 Phase 02 T03 (Drift 5) — captured at await-resolution
  // time so Step 4 can render from the HTTP RESPONSE, not from
  // state.initSession (which the SSE `init.complete` clears ~100ms
  // after the response arrives).
  const [lastInitResponse, setLastInitResponse] = createSignal<InitResponse | null>(null);

  // Milestone 23 Phase 02 T03 — error category branches the inline
  // error UI: 'already-initialized' renders the recovery affordance,
  // 'retryable' renders a [Retry] button, 'fatal' renders the message
  // only. `null` means no error.
  const [errorKind, setErrorKind] = createSignal<
    'already-initialized' | 'retryable' | 'fatal' | null
  >(null);

  // Milestone 23 Phase 03 (PA-1) — the former component-local `mapClicked`
  // signal is GONE. The in-flight flag now lives in dashboard-store as
  // `state.isMappingCodebase` and is read here via `props.isMappingCodebase()`.
  // Single source of truth so the wizard + the persistent
  // `<CodebaseMapPrompt>` banner observe the same value (no parallel
  // signals; no UI drift).

  // ── /api/init-precheck resource (Step 1 auto-detect) ─────────────────
  // Milestone 23 Phase 02 T02. Fires once on mount; the response either
  // short-circuits the wizard into the "already initialized" branch or
  // drives the 2-line auto-detection display above the name input.
  const [precheck] = createResource<InitPrecheckResponse>(fetchInitPrecheck);

  // Plan 03-01 T3 — the form is disabled while either the scaffold POST
  // is in flight (props.submitting from initSubmitting) OR the init Lead
  // is running on the daemon (initSession.status === 'detecting'). With
  // milestone 23's synchronous scaffold, `detecting` is a sub-second
  // flash. Retained per Drift 6 — same prop contract still applies.
  const isBusy = (): boolean => props.submitting || props.initSession()?.status === 'detecting';

  // ── Submit handler (T03 final form) ──────────────────────────────────
  // Wires the [Initialize SWT →] button to POST /api/init via
  // props.onInit. On success: capture response → setStep(4). On 409:
  // surface the already-initialized affordance. On 5xx / network: show
  // [Retry]. On other 4xx / parse errors: show fatal inline.
  const handleSubmit = async (e?: Event): Promise<void> => {
    if (e) e.preventDefault();
    if (isBusy()) return;
    if (!isStep1Complete(name())) {
      setError('Project name is required.');
      setErrorKind('fatal');
      setStep(1);
      return;
    }
    setError(null);
    setErrorKind(null);
    setStep(3);
    try {
      const body = buildInitBody({
        name: name(),
        description: description(),
        planningTracking: planningTracking(),
        autoPush: autoPush(),
      });
      const response = await props.onInit(body);
      setLastInitResponse(response);
      setStep(4);
    } catch (err: unknown) {
      const kind = classifyInitError(err);
      setErrorKind(kind);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Surface the error on Step 2 so the user can act on it. The
      // 'already-initialized' branch has its own affordance below the
      // error message.
      setStep(2);
    }
  };

  // Milestone 23 Phase 03 (PA-1) — Step 4's `[Map codebase]` button calls
  // the hoisted store action. The action is the single entry point for
  // triggering mapping; the persistent CodebaseMapPrompt banner also calls
  // it. The action returns a Promise<{ok}|{error}> but we don't await it
  // here — the in-flight UI state is driven by `props.isMappingCodebase()`.
  const handleMapCodebaseClick = (): void => {
    props.onMapCodebase();
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

              {/* Phase-01 precheck auto-detection display */}
              <Show
                when={precheck()}
                fallback={
                  <div class="init-wizard-precheck" data-loading="true" role="status">
                    Detecting project state…
                  </div>
                }
              >
                {(p) => (
                  <Show
                    when={!p().already_initialized}
                    fallback={
                      <div class="init-wizard-already-initialized" role="status">
                        Project already initialized — go to dashboard.
                      </div>
                    }
                  >
                    {/* Type narrowing: already_initialized=false branch has all fields */}
                    {(() => {
                      const detail = p() as Extract<
                        InitPrecheckResponse,
                        { already_initialized: false }
                      >;
                      return (
                        <div class="init-wizard-precheck" role="status">
                          <span>
                            {describePrecheckMode(detail.brownfield, detail.source_file_count)}
                          </span>
                          <span>{describeGitState(detail.git)}</span>
                        </div>
                      );
                    })()}
                  </Show>
                )}
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
                <div
                  class="init-wizard-error-panel"
                  data-kind={errorKind() ?? 'fatal'}
                  role="alert"
                >
                  <Show when={errorKind() === 'already-initialized'}>
                    <p class="init-error">This project is already initialized — go to dashboard.</p>
                  </Show>
                  <Show when={errorKind() !== 'already-initialized'}>
                    <p class="init-error">{error()}</p>
                  </Show>
                  <Show when={errorKind() === 'retryable'}>
                    <button
                      type="button"
                      class="init-wizard-secondary"
                      onClick={() => void handleSubmit()}
                    >
                      Retry
                    </button>
                  </Show>
                </div>
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
                  disabled={isBusy()}
                  onClick={(e) => void handleSubmit(e)}
                >
                  Initialize SWT →
                </button>
              </div>
            </section>
          </Match>

          {/* ── Step 3 — Scaffold progress (T02 placeholder) ─────────── */}
          <Match when={step() === 3}>
            <section class="init-wizard-step-panel init-wizard-progress" aria-live="polite">
              <h2 class="init-wizard-step-heading">Scaffolding…</h2>
              <p class="init-wizard-lede">
                ◆ Writing <code>.swt-planning/</code>…
              </p>
            </section>
          </Match>

          {/* ── Step 4 — Complete ───────────────────────────────────── */}
          <Match when={step() === 4}>
            <section class="init-wizard-step-panel init-wizard-complete">
              <h2 class="init-wizard-step-heading">Complete.</h2>
              <Show
                when={lastInitResponse()}
                fallback={
                  <p class="init-wizard-lede">SWT is initialized. Dashboard takes over shortly.</p>
                }
              >
                {(response) => {
                  const summary = summarizeInitResponse(response());
                  return (
                    <div class="init-wizard-summary">
                      <p class="init-wizard-lede">SWT is initialized.</p>
                      <ul class="init-wizard-checklist">
                        <li>{summary.modeLabel}</li>
                        <Show when={summary.gitInitializedLabel}>
                          {(label) => <li>{label()}</li>}
                        </Show>
                        <Show when={summary.stackLabel}>{(label) => <li>{label()}</li>}</Show>
                        <li>
                          {summary.fileCount} file{summary.fileCount === 1 ? '' : 's'} created
                          <Show when={summary.filesPreview.length > 0}>
                            <ul class="init-wizard-files-preview">
                              {summary.filesPreview.map((f) => (
                                <li>
                                  <code>{f}</code>
                                </li>
                              ))}
                              <Show when={summary.fileCount > summary.filesPreview.length}>
                                <li>…and {summary.fileCount - summary.filesPreview.length} more</li>
                              </Show>
                            </ul>
                          </Show>
                        </li>
                      </ul>
                      <div class="init-wizard-actions">
                        <button
                          type="button"
                          class="init-wizard-secondary"
                          disabled={props.isMappingCodebase()}
                          onClick={handleMapCodebaseClick}
                        >
                          {props.isMappingCodebase() ? 'Mapping…' : 'Map codebase'}
                        </button>
                      </div>
                    </div>
                  );
                }}
              </Show>
            </section>
          </Match>
        </Switch>
      </div>
    </div>
  );
};
