import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';

import type { InitBody } from '../services/api.js';
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

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Belt-and-suspenders against double-fire on rapid clicks. The button is
    // also disabled via isBusy(), but the form itself can still submit on
    // Enter when focus is in the textarea, so guard here too.
    if (isBusy()) return;
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
            <button type="submit" class="init-submit" disabled={isBusy()}>
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
