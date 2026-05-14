/**
 * User Notes — a freeform per-project scratchpad card.
 *
 * A plain `<textarea>` the user records notes in so they don't forget
 * things. DELIBERATELY decoupled from the methodology artifacts: it is
 * backed by an isolated file (`<cwd>/.swt-planning/USER_NOTES.md`), it is
 * NOT on the tools poll loop (polling would clobber in-progress typing),
 * and the server route publishes no SSE event.
 *
 * **Auto-save, debounced.** There is no Save button. ~800 ms after the
 * user stops typing, the panel POSTs the textarea content via
 * `props.onSave`. A subtle status line shows `Saved` / `Saving…` /
 * `Unsaved changes` / an inline error.
 *
 * **Clobber-avoidance.** The textarea is seeded from `props.data?.notes`
 * ONLY while the field is not dirty (a `createEffect` gated on `!dirty()`),
 * so a fresh bootstrap load or a manual ↻ refresh populates it, but server
 * data never overwrites in-progress typing.
 *
 * **Test pattern.** The dashboard workspace has no `@solidjs/testing-library`
 * and vitest runs `environment: 'node'`, so the load-bearing logic is
 * factored into PURE exported helpers (`isNotesDirty`,
 * `shouldAdoptServerValue`, `formatSaveStatus`) unit-tested directly in
 * `user-notes-panel.test.ts`. The helpers are DOM-free by construction —
 * DOM globals (`Node`, etc.) are `undefined` under node-env vitest.
 */

import { Show, createEffect, createSignal, onCleanup, type Component, type JSX } from 'solid-js';

import type { UserNotesSnapshot } from '../services/api.js';

export interface UserNotesPanelProps {
  data: UserNotesSnapshot | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful fetch, or null. */
  lastFetched: string | null;
  onRefresh: () => void;
  /**
   * Invoked (debounced) when the user stops typing. The parent wraps the
   * store's `saveUserNotes`. Returns `{ok:true}` on success or `{error}` on
   * failure — the panel surfaces the error inline and keeps the field dirty
   * so the next keystroke retries.
   */
  onSave: (notes: string) => Promise<{ ok: true } | { error: string }>;
}

/** The save-status state machine the panel cycles through. */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

/** ~800 ms — the debounce window between the last keystroke and a save. */
export const SAVE_DEBOUNCE_MS = 800;

/**
 * Whether the textarea content diverges from the last-saved server value.
 * Pure, DOM-free — exported for direct unit testing. `savedNotes` is the
 * `props.data?.notes` the panel last adopted (treated as `''` when null).
 */
export function isNotesDirty(current: string, savedNotes: string | null): boolean {
  return current !== (savedNotes ?? '');
}

/**
 * Whether the panel should adopt the incoming server value into the
 * textarea. It adopts ONLY when the field is not dirty — so a bootstrap
 * load or a manual ↻ refresh populates the textarea, but server data never
 * overwrites the user's in-progress typing. Pure, DOM-free.
 */
export function shouldAdoptServerValue(dirty: boolean): boolean {
  return !dirty;
}

/**
 * Render the save-status line text for a given `SaveState`. Pure, DOM-free
 * — exported so the panel's tests assert the status copy without a DOM
 * renderer. The `error` variant carries the message verbatim.
 */
export function formatSaveStatus(state: SaveState): string {
  switch (state.kind) {
    case 'idle':
      return 'Saved';
    case 'unsaved':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return state.message;
  }
}

/**
 * Format an ISO-8601 timestamp as a relative-time string ("12s ago", "3m
 * ago", "1h ago"). Returns "—" when the input is null or invalid. Local
 * copy of `ConfigPanel`'s helper — a tiny leaf utility, cheaper to copy
 * than to factor a shared module for one more panel.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/* ── UserNotesPanel ─────────────────────────────────────────────────── */

export const UserNotesPanel: Component<UserNotesPanelProps> = (props) => {
  // The textarea's content — the single source of truth for what the user
  // sees. Seeded from `props.data?.notes` via the createEffect below, but
  // only while not dirty (clobber-avoidance).
  const [value, setValue] = createSignal<string>(props.data?.notes ?? '');
  // `dirty` tracks whether `value()` diverges from the last-saved content.
  // Gates both the auto-save trigger AND the adopt-server-value effect.
  const [dirty, setDirty] = createSignal<boolean>(false);
  const [saveState, setSaveState] = createSignal<SaveState>({ kind: 'idle' });

  // The debounce timer ref — held across renders so a new keystroke can
  // cancel the pending save and restart the window.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // The notes value the panel last adopted from the server. Tracked
  // separately from `props.data` so `isNotesDirty` compares against what
  // the textarea was actually seeded with.
  let adoptedNotes: string = props.data?.notes ?? '';

  // Clobber-avoidance: adopt `props.data?.notes` into the textarea ONLY
  // while the field is not dirty. A bootstrap load or a manual ↻ refresh
  // (both land via `props.data`) repopulates the textarea; in-progress
  // typing is never overwritten.
  createEffect(() => {
    const serverNotes = props.data?.notes ?? '';
    if (shouldAdoptServerValue(dirty())) {
      adoptedNotes = serverNotes;
      setValue(serverNotes);
    }
  });

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runSave = async (): Promise<void> => {
    debounceTimer = null;
    const toSave = value();
    setSaveState({ kind: 'saving' });
    const result = await props.onSave(toSave);
    if ('error' in result) {
      // Keep `dirty` true so the next keystroke retries the save.
      setSaveState({ kind: 'error', message: result.error });
      return;
    }
    // Success — the saved text is now the server value; the field is clean.
    adoptedNotes = toSave;
    setDirty(false);
    setSaveState({ kind: 'saved' });
  };

  const handleInput = (next: string): void => {
    setValue(next);
    const nowDirty = isNotesDirty(next, adoptedNotes);
    setDirty(nowDirty);
    if (!nowDirty) {
      // Typed back to exactly the saved content — cancel any pending save
      // and drop back to the clean state.
      clearDebounce();
      setSaveState({ kind: 'idle' });
      return;
    }
    setSaveState({ kind: 'unsaved' });
    clearDebounce();
    debounceTimer = setTimeout(() => {
      void runSave();
    }, SAVE_DEBOUNCE_MS);
  };

  // Clear the debounce timer on unmount so a pending save can't fire into
  // a torn-down component.
  onCleanup(clearDebounce);

  return (
    <section class="panel tools-panel user-notes-panel" aria-label="User Notes">
      <header class="tools-panel-header">
        <h2 class="panel-header">User Notes</h2>
        <div class="tools-panel-actions">
          <button
            type="button"
            class="tools-refresh-btn"
            aria-label="Refresh user notes"
            disabled={props.loading}
            onClick={props.onRefresh}
          >
            ↻
          </button>
        </div>
      </header>
      <p class="tools-panel-meta">
        <span class={`user-notes-status user-notes-status-${saveState().kind}`} aria-live="polite">
          {formatSaveStatus(saveState())}
        </span>{' '}
        · {formatRelative(props.lastFetched)}
      </p>
      <textarea
        class="user-notes-textarea"
        aria-label="Project notes"
        placeholder="Jot down notes for this project so you don't forget…"
        value={value()}
        onInput={(e): void => handleInput(e.currentTarget.value)}
      />
      <Show when={saveState().kind === 'error' && props.error === null}>
        {/* The save-status line already carries the error message; this
            banner mirrors ConfigPanel's `tools-panel-error` styling so a
            save failure is unmissable. */}
        <p class="tools-panel-error">⚠ {formatSaveStatus(saveState())}</p>
      </Show>
      <Show when={props.error}>
        {(message): JSX.Element => <p class="tools-panel-error">⚠ {message()}</p>}
      </Show>
    </section>
  );
};
