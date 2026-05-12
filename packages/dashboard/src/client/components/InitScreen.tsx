import { Show, createSignal, type Component } from 'solid-js';

import type { InitBody } from '../services/api.js';

export interface InitScreenProps {
  submitting: boolean;
  /**
   * True when the daemon detected source files in cwd but no
   * `.swt-planning/` — the user is dropping SWT into an existing project.
   * Drives the headline + step copy + CTA wording.
   */
  brownfield: boolean;
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

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Belt-and-suspenders against double-fire on rapid clicks. The button is
    // also disabled via props.submitting, but the form itself can still
    // submit on Enter when focus is in the textarea, so guard here too.
    if (props.submitting) return;
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

  const submitLabel = (): string =>
    props.brownfield
      ? props.submitting
        ? '◆ Initializing…'
        : '✓ Initialize SWT for this codebase'
      : props.submitting
        ? '◆ Initializing…'
        : '✓ Initialize SWT project';

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
              disabled={props.submitting}
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
              disabled={props.submitting}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </label>

          <Show when={error()}>
            <p class="init-error">{error()}</p>
          </Show>

          <div class="init-actions">
            <button type="submit" class="init-submit" disabled={props.submitting}>
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
