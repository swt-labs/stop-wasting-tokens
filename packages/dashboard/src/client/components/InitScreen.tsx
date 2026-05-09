import { Show, createSignal, type Component } from 'solid-js';

import type { InitBody } from '../services/api.js';

export interface InitScreenProps {
  submitting: boolean;
  onInit: (body: InitBody) => Promise<void>;
}

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

  return (
    <div class="init-screen" role="dialog" aria-label="Initialize SWT project">
      <form class="init-card" onSubmit={(e) => void submit(e)}>
        <h1 class="init-title">
          <span class="topbar-brand-mark">swt</span>
          <span class="topbar-brand-cursor">_</span>
        </h1>
        <p class="init-lede">
          No <code>.swt-planning/</code> here yet. Name your project to scaffold one. You can refine
          everything else from <code>swt vibe</code> after this.
        </p>

        <label class="init-field">
          <span>Project name</span>
          <input
            type="text"
            class="init-input"
            placeholder="my-swt-project"
            autocomplete="off"
            spellcheck={false}
            disabled={props.submitting}
            value={name()}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
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
            onInput={(e) => setDescription((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </label>

        <Show when={error()}>
          <p class="init-error">{error()}</p>
        </Show>

        <div class="init-actions">
          <button type="submit" class="init-submit" disabled={props.submitting}>
            {props.submitting ? '◆ Initializing…' : '✓ Initialize SWT project'}
          </button>
        </div>

        <p class="init-fineprint">
          Creates <code>.swt-planning/PROJECT.md</code>, <code>.swt-planning/STATE.md</code>, and an
          empty <code>phases/</code> dir. The dashboard reconnects automatically.
        </p>
      </form>
    </div>
  );
};
