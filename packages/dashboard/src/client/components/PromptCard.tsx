/**
 * Plan 01-05 (Phase 1) — PromptCard component for the askUser dashboard
 * primary path.
 *
 * Renders the prompts store's FIFO queue as a stack of cards. Each card
 * implements the references/ask-user-question.md contract:
 *
 *   - Short header (◆ awaiting glyph from references/swt-brand-essentials.md).
 *   - Question body.
 *   - 1–4 options as buttons; the one with `isRecommended: true` gets a
 *     border emphasis + a "Recommended" tag.
 *   - Always an "Other" button at the bottom that exposes a freeform
 *     textarea + submit.
 *   - Multi-select mode renders checkboxes with a "Submit" button instead.
 *   - Optional `preview` block rendered below the question for visual
 *     comparisons (e.g. diffs).
 *
 * No ANSI colours — uses the existing dashboard CSS tokens (var(--…)) so the
 * card matches the rest of the dashboard's terminal-aesthetic theme. The
 * card is mounted in App.tsx between PhaseStepper and ArtifactTree so
 * unresolved prompts surface prominently (per TDD3 §15.1 pane 3 + plan
 * task 4 done criteria).
 */

import type { PromptRequestEvent } from '@swt-labs/shared';
import { For, Show, createSignal, type Component } from 'solid-js';

import { createPromptsStore, type PromptsStore } from '../state/prompts.js';

export interface PromptCardProps {
  /**
   * Optional injected store — used by tests to drive state without auto-
   * mounting the SSE listener. Production callers omit and accept the
   * default store from `createPromptsStore()`.
   */
  store?: PromptsStore;
}

interface SingleCardProps {
  prompt: PromptRequestEvent;
  onRespond: (selectedOption: string | null, freeform: string | null) => Promise<void>;
}

const SingleCard: Component<SingleCardProps> = (props) => {
  const [showOther, setShowOther] = createSignal(false);
  const [freeform, setFreeform] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Multi-select track — keyed by option label. The "submit" button is
  // disabled until at least one option is checked.
  const [multiPicked, setMultiPicked] = createSignal<Set<string>>(new Set());

  const submit = async (
    selectedOption: string | null,
    freeformText: string | null,
  ): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await props.onRespond(selectedOption, freeformText);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOptionClick = (label: string): void => {
    if (props.prompt.multiSelect === true) {
      setMultiPicked((current) => {
        const next = new Set(current);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
      return;
    }
    void submit(label, null);
  };

  const handleMultiSubmit = (): void => {
    const picked = Array.from(multiPicked());
    if (picked.length === 0) return;
    // Multi-select reports the selection as a comma-joined string in
    // selectedOption. Phase 1 keeps the contract simple — downstream
    // wrappers can split on `, ` if they need the array form.
    void submit(picked.join(', '), null);
  };

  const handleOtherSubmit = (): void => {
    const text = freeform().trim();
    if (text.length === 0) return;
    void submit(null, text);
  };

  return (
    <article class="prompt-card" data-prompt-id={props.prompt.prompt_id}>
      <header class="prompt-card-header">
        <span class="prompt-card-glyph" aria-hidden="true">
          ◆
        </span>
        <Show when={props.prompt.header}>
          <h3 class="prompt-card-title">{props.prompt.header}</h3>
        </Show>
      </header>
      <p class="prompt-card-question">{props.prompt.question}</p>
      <Show when={props.prompt.preview}>
        <pre class="prompt-card-preview">{props.prompt.preview}</pre>
      </Show>
      <Show
        when={props.prompt.multiSelect === true}
        fallback={
          <div class="prompt-card-options" role="group" aria-label="Options">
            <For each={props.prompt.options}>
              {(opt) => (
                <button
                  type="button"
                  class="prompt-card-option"
                  data-recommended={opt.isRecommended === true ? 'true' : 'false'}
                  disabled={submitting()}
                  onClick={() => handleOptionClick(opt.label)}
                >
                  <span class="prompt-card-option-label">{opt.label}</span>
                  <Show when={opt.isRecommended === true}>
                    <span class="prompt-card-option-recommended" aria-label="Recommended">
                      Recommended
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        }
      >
        <div
          class="prompt-card-options prompt-card-options-multi"
          role="group"
          aria-label="Options"
        >
          <For each={props.prompt.options}>
            {(opt) => (
              <label
                class="prompt-card-multi-option"
                data-recommended={opt.isRecommended === true ? 'true' : 'false'}
              >
                <input
                  type="checkbox"
                  checked={multiPicked().has(opt.label)}
                  disabled={submitting()}
                  onChange={() => handleOptionClick(opt.label)}
                />
                <span class="prompt-card-option-label">{opt.label}</span>
                <Show when={opt.isRecommended === true}>
                  <span class="prompt-card-option-recommended" aria-label="Recommended">
                    Recommended
                  </span>
                </Show>
              </label>
            )}
          </For>
          <button
            type="button"
            class="prompt-card-multi-submit"
            disabled={submitting() || multiPicked().size === 0}
            onClick={handleMultiSubmit}
          >
            Submit selection
          </button>
        </div>
      </Show>
      <div class="prompt-card-other">
        <Show
          when={showOther()}
          fallback={
            <button
              type="button"
              class="prompt-card-other-toggle"
              disabled={submitting()}
              onClick={() => setShowOther(true)}
            >
              Other (freeform)
            </button>
          }
        >
          <textarea
            class="prompt-card-other-input"
            placeholder="Describe your answer"
            value={freeform()}
            disabled={submitting()}
            onInput={(e) => setFreeform(e.currentTarget.value)}
          />
          <div class="prompt-card-other-actions">
            <button
              type="button"
              class="prompt-card-other-cancel"
              disabled={submitting()}
              onClick={() => {
                setShowOther(false);
                setFreeform('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              class="prompt-card-other-submit"
              disabled={submitting() || freeform().trim().length === 0}
              onClick={handleOtherSubmit}
            >
              Submit freeform
            </button>
          </div>
        </Show>
      </div>
      <Show when={error()}>
        <p class="prompt-card-error" role="alert">
          {error()}
        </p>
      </Show>
    </article>
  );
};

/**
 * Top-level PromptCard panel. Renders the prompts store's queue as a stack
 * of <SingleCard /> children. Hidden when the queue is empty so the panel
 * doesn't take up vertical space when no prompts are pending.
 */
export const PromptCard: Component<PromptCardProps> = (props) => {
  const store = props.store ?? createPromptsStore();
  return (
    <Show when={store.prompts().length > 0}>
      <section class="prompt-card-panel" aria-label="Pending prompts">
        <For each={store.prompts()}>
          {(prompt) => (
            <SingleCard
              prompt={prompt}
              onRespond={(selectedOption, freeform) =>
                store.respondToPrompt(prompt.prompt_id, { selectedOption, freeform })
              }
            />
          )}
        </For>
      </section>
    </Show>
  );
};
