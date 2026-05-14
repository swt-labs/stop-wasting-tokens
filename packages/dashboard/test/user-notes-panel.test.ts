/**
 * `<UserNotesPanel>` coverage — the freeform scratchpad card.
 *
 * The dashboard workspace has no Solid testing-library and vitest runs
 * `environment: 'node'`, so the panel's load-bearing logic is factored
 * into PURE exported helpers (`isNotesDirty`, `shouldAdoptServerValue`,
 * `formatSaveStatus`, `formatRelative`) — unit-tested directly here, plus
 * a smoke test that `UserNotesPanel` is a callable Solid component. The
 * helpers are DOM-free by construction (DOM globals are `undefined` under
 * node-env vitest). Mirrors `provider-auth-panel.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  SAVE_DEBOUNCE_MS,
  UserNotesPanel,
  formatRelative,
  formatSaveStatus,
  isNotesDirty,
  shouldAdoptServerValue,
  type SaveState,
} from '../src/client/components/UserNotesPanel.jsx';

describe('<UserNotesPanel>', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof UserNotesPanel).toBe('function');
  });

  it('debounces at ~800ms', () => {
    // The spec locks the auto-save debounce window at ~800ms.
    expect(SAVE_DEBOUNCE_MS).toBe(800);
  });
});

/* dirty detection — the textarea content vs. the last-adopted server value */
describe('isNotesDirty', () => {
  it('is false when the current text equals the saved value', () => {
    expect(isNotesDirty('hello', 'hello')).toBe(false);
  });

  it('is true when the current text diverges from the saved value', () => {
    expect(isNotesDirty('hello world', 'hello')).toBe(true);
  });

  it('treats a null saved value as the empty string', () => {
    // Greenfield: props.data is null → saved value is "".
    expect(isNotesDirty('', null)).toBe(false);
    expect(isNotesDirty('typed something', null)).toBe(true);
  });

  it('is false when the user types back to exactly the saved content', () => {
    // The panel uses this to drop back to the clean state + cancel the
    // pending save when the edit is reverted.
    expect(isNotesDirty('original', 'original')).toBe(false);
  });

  it('is true for a whitespace-only divergence (no trimming)', () => {
    // The scratchpad is freeform — trailing whitespace IS a real edit.
    expect(isNotesDirty('note ', 'note')).toBe(true);
  });
});

/* adopt-server-value gate — clobber-avoidance */
describe('shouldAdoptServerValue', () => {
  it('adopts the server value when the field is NOT dirty', () => {
    // A fresh bootstrap load or a manual ↻ refresh populates the textarea.
    expect(shouldAdoptServerValue(false)).toBe(true);
  });

  it('does NOT adopt the server value while the field is dirty', () => {
    // In-progress typing must never be overwritten by incoming server data.
    expect(shouldAdoptServerValue(true)).toBe(false);
  });
});

/* save-status formatting — the subtle status line copy */
describe('formatSaveStatus', () => {
  it('renders "Saved" for the idle state', () => {
    expect(formatSaveStatus({ kind: 'idle' })).toBe('Saved');
  });

  it('renders "Unsaved changes" for the unsaved state', () => {
    expect(formatSaveStatus({ kind: 'unsaved' })).toBe('Unsaved changes');
  });

  it('renders "Saving…" for the saving state', () => {
    expect(formatSaveStatus({ kind: 'saving' })).toBe('Saving…');
  });

  it('renders "Saved" for the saved state', () => {
    expect(formatSaveStatus({ kind: 'saved' })).toBe('Saved');
  });

  it('renders the error message verbatim for the error state', () => {
    const state: SaveState = { kind: 'error', message: 'user_notes_write_failed: EACCES' };
    expect(formatSaveStatus(state)).toBe('user_notes_write_failed: EACCES');
  });
});

/* formatRelative — the last-fetched meta timestamp */
describe('formatRelative', () => {
  it('renders "—" for null or an invalid timestamp', () => {
    expect(formatRelative(null)).toBe('—');
    expect(formatRelative('not-a-date')).toBe('—');
  });

  it('renders an ISO timestamp as a relative-time string', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    expect(formatRelative(tenSecondsAgo)).toMatch(/^\d+s ago$/);
  });
});
