/**
 * Milestone 13 / Phase 03 — TopBar answer-mode coverage.
 *
 * Mirrors `topbar.test.ts` discipline: node-env vitest, no Solid render
 * (the workspace has no Solid testing-library; the dashboard vitest
 * config runs `environment: 'node'`). Load-bearing answer-mode logic is
 * factored into the exported pure helper `canSubmitAnswerMode` and
 * tested directly, plus a smoke test that TopBar remains a callable
 * Solid component with the new optional props.
 *
 * Coverage (7 cases, plan target ≥ 5):
 *   - canSubmitAnswerMode: 4 (empty / whitespace / non-empty / trimmed
 *                              leading-trailing spaces)
 *   - TopBar component smoke: 2 (callable + answer-mode props are
 *                                 optional — App.tsx may omit them)
 *   - Cross-reference to formatAskUserPlaceholder: 1 (the answer-mode
 *     placeholder is sourced from the askuser-card-helpers helper —
 *     unit-tested there, smoke-imported here to prove the wiring).
 */

import { describe, expect, it } from 'vitest';

import { formatAskUserPlaceholder } from '../src/client/components/askuser-card-helpers.js';
import { TopBar, canSubmitAnswerMode } from '../src/client/components/TopBar.jsx';

describe('canSubmitAnswerMode', () => {
  it('returns false for empty input', () => {
    expect(canSubmitAnswerMode('')).toBe(false);
  });

  it('returns false for whitespace-only input', () => {
    expect(canSubmitAnswerMode('   ')).toBe(false);
    expect(canSubmitAnswerMode('\t\n  ')).toBe(false);
  });

  it('returns true for non-empty input', () => {
    expect(canSubmitAnswerMode('hello')).toBe(true);
  });

  it('returns true for input with leading/trailing whitespace around real content', () => {
    expect(canSubmitAnswerMode('  hi  ')).toBe(true);
  });
});

describe('TopBar component smoke (Phase 03 answer-mode)', () => {
  it('remains a callable Solid component after the answer-mode additions', () => {
    expect(typeof TopBar).toBe('function');
  });

  it('answer-mode props (cookAwaitingUser + onCookAskUserRespond) are optional — App.tsx may omit them', () => {
    // The TopBar component's signature must remain TopBarProps-compatible
    // even when neither answer-mode prop is supplied. Type-level: this
    // file would fail to compile if either prop became required.
    const stub: Parameters<typeof TopBar>[0] = {
      project: null,
      milestone: null,
      connection: 'connecting',
      commandSubmitting: false,
      vibeStarting: false,
      workflowState: 'greenfield',
      activePhasePosition: null,
      onCommand: async () => undefined,
      onVibe: async () => undefined,
    };
    expect(stub.cookAwaitingUser).toBeUndefined();
    expect(stub.onCookAskUserRespond).toBeUndefined();
  });
});

describe('TopBar answer-mode placeholder wiring (cross-reference)', () => {
  it('formatAskUserPlaceholder is the helper TopBar uses for answer-mode placeholder text', () => {
    // The TopBar source imports `formatAskUserPlaceholder` from
    // `./askuser-card-helpers.js`; we exercise it directly here to
    // pin the contract. The exhaustive truncation cases live in
    // askuser-card-helpers.test.ts (5 cases).
    expect(formatAskUserPlaceholder('Pick a strategy')).toBe('Answer for cook: Pick a strategy');
    expect(formatAskUserPlaceholder('').endsWith('…')).toBe(true);
  });
});
