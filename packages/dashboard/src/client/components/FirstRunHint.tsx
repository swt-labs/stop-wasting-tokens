/**
 * Plan 04-01 (milestone 12, Phase 04) — first-run hint banner.
 *
 * Mounts above the resizable phase grid (App.tsx line 186, inside the
 * `<Show when={isInitialized()}>` body). Shows a friendly two-mode
 * primer ("type to chat OR pick a verb to drive a phase") whenever the
 * dashboard is initialized AND no chat / vibe session is in flight AND
 * the user has not dismissed the hint.
 *
 * Visibility decision lives in `shouldShowHint` (first-run-hint-helpers).
 * Dismissal flow:
 *   - `onMount` reads the project-scoped localStorage key; if the value
 *     is `"true"` the dismissed signal seeds true and the banner stays
 *     hidden.
 *   - Close button (×) writes `"true"` to the same key and sets the
 *     dismissed signal. Persistent across reloads.
 *   - First-submit auto-persist: a `createEffect` watches the chat /
 *     vibe session signals; when either transitions from null → non-null
 *     for the FIRST time after mount, the dismissed signal flips to true
 *     AND the same localStorage key is written. Persistent across
 *     reloads — the user does not need to click × explicitly.
 *   - Auto-hide when chat or vibe sessions become non-null is handled
 *     by the shouldShowHint predicate itself (no explicit listener
 *     needed for the in-session visual state); the createEffect above
 *     handles the persistence side-effect required by plan must_have.
 */
import { Show, createEffect, createSignal, onMount, type Component } from 'solid-js';

import type { DashboardState } from '../state/dashboard-store.js';

import { firstRunHintStorageKey, shouldShowHint } from './first-run-hint-helpers.js';

export interface FirstRunHintProps {
  state: DashboardState;
  projectRoot: string;
}

export const FirstRunHint: Component<FirstRunHintProps> = (props) => {
  const [dismissed, setDismissed] = createSignal(false);

  /**
   * Write `"true"` to the project-scoped localStorage key + flip the
   * dismissed signal. Shared by the close button and the first-submit
   * createEffect below.
   */
  const persistDismissal = (): void => {
    try {
      globalThis.localStorage?.setItem(firstRunHintStorageKey(props.projectRoot), 'true');
    } catch {
      // best-effort persistence; signal flip below still hides the
      // banner for the rest of this tab's lifetime.
    }
    setDismissed(true);
  };

  onMount(() => {
    try {
      const stored = globalThis.localStorage?.getItem(firstRunHintStorageKey(props.projectRoot));
      if (stored === 'true') setDismissed(true);
    } catch {
      // localStorage unavailable (SSR, private browsing) — fall through
      // and let the predicate-driven visibility do its job.
    }
  });

  // First-submit auto-persist (plan must_have MH-16): when either chat or
  // vibe session transitions from null → non-null for the FIRST time
  // after mount, persist dismissal to localStorage so the hint stays
  // dismissed across reloads even if the user never clicks ×.
  //
  // Milestone 13 / Phase 01 — the chat-session read is now
  // `state.chat_session_id !== null` (replaces the deleted `state.chatSession`
  // slot). Semantics unchanged: any chat-thread adoption auto-dismisses.
  createEffect(() => {
    const hasActiveSession =
      props.state.chat_session_id !== null || props.state.vibeSession !== null;
    if (hasActiveSession && !dismissed()) {
      persistDismissal();
    }
  });

  const handleClose = (): void => {
    persistDismissal();
  };

  return (
    <Show when={shouldShowHint(props.state, dismissed())}>
      <aside class="first-run-hint" aria-label="First-run hint">
        <div class="first-run-hint-body">
          <strong>New here?</strong> Type to chat with the LLM, or pick a verb (cook / qa / verify /
          ...) to drive a methodology phase. Both modes share the same provider credential.
        </div>
        <button
          type="button"
          class="first-run-hint-close"
          aria-label="Dismiss first-run hint"
          onClick={handleClose}
        >
          ×
        </button>
      </aside>
    </Show>
  );
};
