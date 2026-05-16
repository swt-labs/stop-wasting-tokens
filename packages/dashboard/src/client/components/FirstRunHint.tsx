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
 *   - Auto-hide when chat or vibe sessions become non-null is handled
 *     by the shouldShowHint predicate itself (no explicit listener
 *     needed); the in-session case is transient — if the user closes
 *     the session, the hint reappears unless they also clicked × at
 *     some point.
 *
 * Auto-dismiss-on-first-submit variant chosen: persist via the close
 * button ONLY. The predicate-driven auto-hide covers the in-session
 * case; persisting on first-submit would surprise users who briefly
 * toggled chat just to read what the banner said. See 04-01-SUMMARY for
 * the rationale.
 */
import { Show, createSignal, onMount, type Component } from 'solid-js';

import type { DashboardState } from '../state/dashboard-store.js';

import { firstRunHintStorageKey, shouldShowHint } from './first-run-hint-helpers.js';

export interface FirstRunHintProps {
  state: DashboardState;
  projectRoot: string;
}

export const FirstRunHint: Component<FirstRunHintProps> = (props) => {
  const [dismissed, setDismissed] = createSignal(false);

  onMount(() => {
    try {
      const stored = globalThis.localStorage?.getItem(firstRunHintStorageKey(props.projectRoot));
      if (stored === 'true') setDismissed(true);
    } catch {
      // localStorage unavailable (SSR, private browsing) — fall through
      // and let the predicate-driven visibility do its job.
    }
  });

  const handleClose = (): void => {
    try {
      globalThis.localStorage?.setItem(firstRunHintStorageKey(props.projectRoot), 'true');
    } catch {
      // best-effort persistence; signal flip below still hides the
      // banner for the rest of this tab's lifetime.
    }
    setDismissed(true);
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
