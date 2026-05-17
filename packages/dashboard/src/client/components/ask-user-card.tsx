/**
 * Milestone 13 / Phase 03 — `<AskUserCard>`.
 *
 * Renders a single cook askUser CookAskUserEntry as an interactive card
 * (pending), a compact answered summary (answered), or a dimmed
 * timed-out caption (expired). The card branches on `askUserCardMode`;
 * inside the interactive branch there are two sub-modes (option-grid /
 * freeform-textarea) gated by `entry.options.length` and
 * `entry.allowFreeform` per VBW `references/ask-user-question.md` and
 * Scout §3 / §8:
 *
 *   - options.length === 0           → textarea-only (the textarea IS
 *                                       the freeform experience; no fake
 *                                       bounded menu).
 *   - options.length > 0,
 *     !showFreeform                  → option grid; an `Other` button
 *                                       appears ONLY when
 *                                       `entry.allowFreeform === true`.
 *   - options.length > 0,
 *     showFreeform                   → textarea + Back + Send (Send is
 *                                       gated on non-empty trimmed text
 *                                       — Scout §8 shallow-acceptance
 *                                       prevention).
 *
 * Recommended badge: an option with the Phase 02 sentinel
 * `description === 'Recommended'` (`classifyOptionStyle` →
 * `'recommended'`) gets the `.ask-user-card-option-btn--recommended`
 * modifier and a `<span>Recommended</span>` badge inside the button.
 *
 * Dispatch: a single `props.onRespond({selectedOption, freeform})`
 * callback. Option click → `{selectedOption: option.value, freeform:
 * null}`; freeform Send → `{selectedOption: null, freeform:
 * textValue().trim()}`. The action (`respondToCookAskUser` in the
 * store) owns optimistic state + the POST.
 */
import type { CookAskUserEntry } from '@swt-labs/shared';
import { For, Match, Show, Switch, createSignal, type Component } from 'solid-js';

import { askUserCardMode, classifyOptionStyle } from './askuser-card-helpers.js';

export interface AskUserCardProps {
  entry: CookAskUserEntry;
  onRespond: (body: {
    selectedOption: string | null;
    freeform: string | null;
  }) => Promise<void>;
}

export const AskUserCard: Component<AskUserCardProps> = (props) => {
  // Local UI state — independent of the entry's status field (which is
  // driven by SSE prompt.response / cook.ask_user_timeout reducers).
  const [showFreeform, setShowFreeform] = createSignal(false);
  const [textValue, setTextValue] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  // Defensive read — the schema marks `options` optional. Treat
  // `undefined` as `[]` so the length gates downstream are total.
  const options = (): Array<{ value: string; label: string; description?: string }> =>
    props.entry.options ?? [];

  // Scout §8 — Other button visibility. Always-true `entry.allowFreeform`
  // is the current Phase 02 default; the explicit check future-proofs
  // against a per-prompt opt-out.
  const showOtherButton = (): boolean =>
    options().length > 0 && props.entry.allowFreeform === true;

  // Shallow-acceptance prevention — `Send` is disabled when the trimmed
  // freeform text is empty (Scout §8). canSubmitFreeform mirrors the
  // TopBar's `canSubmitAnswerMode` semantics.
  const canSubmitFreeform = (): boolean => textValue().trim().length > 0;

  const submitOption = async (option: {
    value: string;
    label: string;
    description?: string;
  }): Promise<void> => {
    if (submitting()) return;
    setSubmitting(true);
    try {
      await props.onRespond({ selectedOption: option.value, freeform: null });
    } finally {
      setSubmitting(false);
    }
  };

  const submitFreeform = async (): Promise<void> => {
    if (submitting() || !canSubmitFreeform()) return;
    const text = textValue().trim();
    setSubmitting(true);
    try {
      await props.onRespond({ selectedOption: null, freeform: text });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Switch>
      <Match when={askUserCardMode(props.entry) === 'interactive'}>
        <div class="ask-user-card" data-entry-id={props.entry.id} data-status="pending">
          <div class="ask-user-card-header">
            <span class="ask-user-card-label">cook asks</span>
          </div>
          <div class="ask-user-card-question">{props.entry.question}</div>

          {/* Sub-mode 1: options.length === 0 — textarea is the
              freeform experience; no Other button, no fake menu. */}
          <Show when={options().length === 0}>
            <form
              class="ask-user-card-freeform-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitFreeform();
              }}
            >
              <textarea
                class="ask-user-card-freeform-textarea"
                placeholder="Type your answer…"
                value={textValue()}
                onInput={(e) => setTextValue(e.currentTarget.value)}
                disabled={submitting()}
                autofocus
              />
              <div class="ask-user-card-freeform-actions">
                <button
                  type="submit"
                  class="ask-user-card-send-btn"
                  disabled={submitting() || !canSubmitFreeform()}
                >
                  Send
                </button>
              </div>
            </form>
          </Show>

          {/* Sub-mode 2: options.length > 0 AND !showFreeform — option
              grid + (conditional) Other button. */}
          <Show when={options().length > 0 && !showFreeform()}>
            <div class="ask-user-card-options">
              <For each={options()}>
                {(opt) => {
                  const style = classifyOptionStyle(opt);
                  const isRecommended = style === 'recommended';
                  return (
                    <button
                      type="button"
                      class={
                        'ask-user-card-option-btn' +
                        (isRecommended ? ' ask-user-card-option-btn--recommended' : '')
                      }
                      disabled={submitting()}
                      onClick={() => void submitOption(opt)}
                    >
                      <span class="ask-user-card-option-label">{opt.label}</span>
                      <Show when={isRecommended}>
                        <span class="ask-user-card-recommended-badge">Recommended</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
              <Show when={showOtherButton()}>
                <button
                  type="button"
                  class="ask-user-card-option-btn ask-user-card-option-btn--other"
                  disabled={submitting()}
                  onClick={() => setShowFreeform(true)}
                >
                  Other…
                </button>
              </Show>
            </div>
          </Show>

          {/* Sub-mode 3: options.length > 0 AND showFreeform — textarea +
              Back + Send. */}
          <Show when={options().length > 0 && showFreeform()}>
            <form
              class="ask-user-card-freeform-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitFreeform();
              }}
            >
              <textarea
                class="ask-user-card-freeform-textarea"
                placeholder="Describe your approach…"
                value={textValue()}
                onInput={(e) => setTextValue(e.currentTarget.value)}
                disabled={submitting()}
                autofocus
              />
              <div class="ask-user-card-freeform-actions">
                <button
                  type="button"
                  class="ask-user-card-back-btn"
                  disabled={submitting()}
                  onClick={() => setShowFreeform(false)}
                >
                  Back
                </button>
                <button
                  type="submit"
                  class="ask-user-card-send-btn"
                  disabled={submitting() || !canSubmitFreeform()}
                >
                  Send
                </button>
              </div>
            </form>
          </Show>
        </div>
      </Match>

      <Match when={askUserCardMode(props.entry) === 'answered'}>
        <div
          class="ask-user-card ask-user-card--answered"
          data-entry-id={props.entry.id}
          data-status="answered"
        >
          <div class="ask-user-card-question ask-user-card-question--dimmed">
            {props.entry.question}
          </div>
          <div class="ask-user-card-answered-reply">
            <span class="ask-user-card-reply-arrow">↳</span>{' '}
            <span class="ask-user-card-reply-text">{props.entry.reply ?? ''}</span>
          </div>
        </div>
      </Match>

      <Match when={askUserCardMode(props.entry) === 'expired'}>
        <div
          class="ask-user-card ask-user-card--expired"
          data-entry-id={props.entry.id}
          data-status="expired"
        >
          <div class="ask-user-card-question ask-user-card-question--dimmed">
            {props.entry.question}
          </div>
          <div class="ask-user-card-expired-note">
            <span aria-hidden="true">✕</span> Timed out — cook resumed automatically
          </div>
        </div>
      </Match>
    </Switch>
  );
};
