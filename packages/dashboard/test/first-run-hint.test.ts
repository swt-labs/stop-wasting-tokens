/**
 * Plan 04-01 (milestone 12, Phase 04) P03 — `first-run-hint-helpers` coverage.
 *
 * Mirrors the Phase 03 `chat-panel-helpers.test.ts` discipline: pure
 * function call assertions against the three exported helpers, no DOM,
 * no Solid runtime, no `globalThis.localStorage` mocking (the helpers
 * don't touch localStorage — the FirstRunHint component owns those side
 * effects).
 *
 * Coverage:
 *   - shouldShowHint   — 5 cases (≥ 4 required)
 *   - firstRunHintStorageKey — 3 cases (≥ 2 required)
 *   - dismissReducer   — 4 cases (≥ 3 required)
 *   Total: 12 tests (plan requires ≥ 9).
 */

import { describe, expect, it } from 'vitest';

import {
  FIRST_RUN_HINT_STORAGE_PREFIX,
  dismissReducer,
  firstRunHintStorageKey,
  shouldShowHint,
} from '../src/client/components/first-run-hint-helpers.js';
import type { DashboardState } from '../src/client/state/dashboard-store.js';

/**
 * Build a minimal DashboardState fixture for shouldShowHint coverage.
 * Only the fields the predicate reads (`snapshot`, `chatSession`,
 * `vibeSession`) need real values; the rest is cast through `unknown`
 * to satisfy the structural type without populating two dozen
 * irrelevant slots. Matches the chat-panel-helpers.test.ts pattern.
 */
function makeFakeState(opts: {
  isInitialized: boolean | null;
  chatSession: unknown;
  vibeSession: unknown;
}): DashboardState {
  const snapshot =
    opts.isInitialized === null ? null : ({ is_initialized: opts.isInitialized } as unknown);
  return {
    snapshot,
    chatSession: opts.chatSession,
    vibeSession: opts.vibeSession,
  } as unknown as DashboardState;
}

describe('shouldShowHint', () => {
  it('returns false when state.snapshot is null (greenfield daemon, not yet initialized)', () => {
    const state = makeFakeState({ isInitialized: null, chatSession: null, vibeSession: null });
    expect(shouldShowHint(state, false)).toBe(false);
  });

  it('returns false when initialized but chatSession is set (auto-hide once chat starts)', () => {
    const state = makeFakeState({
      isInitialized: true,
      chatSession: { chat_session_id: 'c-123' },
      vibeSession: null,
    });
    expect(shouldShowHint(state, false)).toBe(false);
  });

  it('returns false when initialized but vibeSession is set (auto-hide once cook starts)', () => {
    const state = makeFakeState({
      isInitialized: true,
      chatSession: null,
      vibeSession: { session_id: 'v-456' },
    });
    expect(shouldShowHint(state, false)).toBe(false);
  });

  it('returns true on a greenfield initialized dashboard with neither session active and not dismissed', () => {
    const state = makeFakeState({ isInitialized: true, chatSession: null, vibeSession: null });
    expect(shouldShowHint(state, false)).toBe(true);
  });

  it('returns false when both sessions are null but the user already dismissed the hint', () => {
    const state = makeFakeState({ isInitialized: true, chatSession: null, vibeSession: null });
    expect(shouldShowHint(state, true)).toBe(false);
  });
});

describe('firstRunHintStorageKey', () => {
  it('returns a key that starts with the documented FIRST_RUN_HINT_STORAGE_PREFIX constant', () => {
    const key = firstRunHintStorageKey('/Users/alex/proj-one');
    expect(key.startsWith(FIRST_RUN_HINT_STORAGE_PREFIX)).toBe(true);
  });

  it('produces distinct keys for distinct projectRoot strings (per-project scoping)', () => {
    const keyA = firstRunHintStorageKey('/Users/alex/proj-one');
    const keyB = firstRunHintStorageKey('/Users/alex/proj-two');
    expect(keyA).not.toBe(keyB);
  });

  it('embeds the projectRoot verbatim after the prefix', () => {
    const root = '/Users/alex/swt-demo';
    expect(firstRunHintStorageKey(root)).toBe(`${FIRST_RUN_HINT_STORAGE_PREFIX}${root}`);
  });
});

describe('dismissReducer', () => {
  const prev = { dismissed: false };

  it('emits dismissed=true + reason=submit-chat when the user submits their first chat turn', () => {
    expect(dismissReducer(prev, 'submit-chat')).toEqual({
      dismissed: true,
      reason: 'submit-chat',
    });
  });

  it('emits dismissed=true + reason=submit-cook when the user submits their first cook seed', () => {
    expect(dismissReducer(prev, 'submit-cook')).toEqual({
      dismissed: true,
      reason: 'submit-cook',
    });
  });

  it('emits dismissed=true + reason=close-button when the user clicks the explicit × button', () => {
    expect(dismissReducer(prev, 'close-button')).toEqual({
      dismissed: true,
      reason: 'close-button',
    });
  });

  it('returns a fresh object on each call (does not mutate the prev argument)', () => {
    const before = { dismissed: false };
    const next = dismissReducer(before, 'close-button');
    expect(before).toEqual({ dismissed: false });
    expect(next).not.toBe(before);
  });
});
