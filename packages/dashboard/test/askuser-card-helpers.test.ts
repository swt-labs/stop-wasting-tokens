/**
 * Milestone 13 / Phase 03 — `askuser-card-helpers` coverage.
 *
 * Mirrors `unified-log-helpers.test.ts` and `first-run-hint.test.ts`:
 * node-env vitest, no DOM, no Solid imports. Each of the four pure
 * helpers is exercised through its load-bearing branches plus at least
 * one negative case per anti-pattern.
 *
 * Cases:
 *   - askUserCardMode          —  3 (pending / answered / expired)
 *   - resolveSubmitTarget      —  5 priority-ladder cases (load-bearing
 *                                 mode-precedence cross-cutting #6)
 *   - formatAskUserPlaceholder —  5 (short / long / empty / custom cap
 *                                 / question exactly at the cap)
 *   - classifyOptionStyle      —  4 (sentinel / undefined / arbitrary
 *                                 non-sentinel / empty string)
 *   Total: 17 tests (plan requires ≥ 10).
 */

import type { CookAskUserEntry } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  askUserCardMode,
  classifyOptionStyle,
  formatAskUserPlaceholder,
  resolveSubmitTarget,
} from '../src/client/components/askuser-card-helpers.js';

const TS = '2026-05-17T14:23:45.123Z';

function makeEntry(
  status: 'pending' | 'answered' | 'expired',
  overrides: Partial<CookAskUserEntry> = {},
): CookAskUserEntry {
  return {
    kind: 'cook-ask-user',
    id: `log-cook-ask-${status}`,
    ts: TS,
    session_id: 'sess-1',
    prompt_id: 'prompt-1',
    question: 'Which migration strategy?',
    options: [
      { value: 'schema-first', label: 'Schema first' },
      { value: 'data-first', label: 'Data first', description: 'Recommended' },
    ],
    status,
    ...overrides,
  } as CookAskUserEntry;
}

describe('askUserCardMode', () => {
  it("returns 'interactive' for a pending entry", () => {
    expect(askUserCardMode(makeEntry('pending'))).toBe('interactive');
  });

  it("returns 'answered' for an answered entry", () => {
    expect(askUserCardMode(makeEntry('answered', { reply: 'Schema first' }))).toBe('answered');
  });

  it("returns 'expired' for an expired entry", () => {
    expect(askUserCardMode(makeEntry('expired'))).toBe('expired');
  });
});

describe('resolveSubmitTarget', () => {
  const cau = {
    askUserId: 'prompt-1',
    question: 'Which migration strategy?',
    options: [],
    allowFreeform: true,
  };

  it("returns 'cook-ask-user' when cookAwaitingUser is non-null AND verb: 'cook' AND chatSessionId set (load-bearing mode-precedence)", () => {
    // This is the cross-cutting #6 load-bearing case: with verb: 'cook'
    // selected AND an active chat thread, cook-ask-user STILL wins over
    // both a sticky cook-verb AND an active chat thread.
    expect(resolveSubmitTarget(cau, 'cook', 's1')).toBe('cook-ask-user');
  });

  it("returns 'cook-ask-user' when cookAwaitingUser is non-null AND verb=null", () => {
    expect(resolveSubmitTarget(cau, null, null)).toBe('cook-ask-user');
  });

  it("returns 'chat' when cookAwaitingUser is null AND verb=null AND chatSessionId set", () => {
    expect(resolveSubmitTarget(null, null, 'chat-session-id')).toBe('chat');
  });

  it("returns 'chat' when cookAwaitingUser is null AND verb=null AND chatSessionId null (starts a new thread)", () => {
    expect(resolveSubmitTarget(null, null, null)).toBe('chat');
  });

  it("returns 'vibe' when cookAwaitingUser is null AND verb='cook'", () => {
    expect(resolveSubmitTarget(null, 'cook', null)).toBe('vibe');
  });

  it("returns 'command' when cookAwaitingUser is null AND verb is a non-cook action verb", () => {
    expect(resolveSubmitTarget(null, 'qa', null)).toBe('command');
    expect(resolveSubmitTarget(null, 'research', null)).toBe('command');
    expect(resolveSubmitTarget(null, 'verify', 's1')).toBe('command');
  });
});

describe('formatAskUserPlaceholder', () => {
  it('returns prefix + full question when within the cap', () => {
    expect(formatAskUserPlaceholder('Pick a strategy')).toBe('Answer for cook: Pick a strategy');
  });

  it('truncates with a single trailing ellipsis when the prefixed string exceeds the default cap (100)', () => {
    // Question is 200 chars; cap is 100. Output must be exactly 100 chars,
    // end with `…`, and start with the prefix.
    const longQuestion = 'x'.repeat(200);
    const out = formatAskUserPlaceholder(longQuestion);
    expect(out.length).toBe(100);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('Answer for cook: ')).toBe(true);
  });

  it("returns 'Answer for cook: …' when the question is empty", () => {
    expect(formatAskUserPlaceholder('')).toBe('Answer for cook: …');
  });

  it('respects a custom maxLen', () => {
    const out = formatAskUserPlaceholder('this is a fairly long question text', 30);
    expect(out.length).toBe(30);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate when the prefixed string is exactly at the cap', () => {
    // 'Answer for cook: ' is 17 chars; 13 chars of question → 30 total.
    const exact = formatAskUserPlaceholder('1234567890123', 30);
    expect(exact).toBe('Answer for cook: 1234567890123');
    expect(exact.length).toBe(30);
    expect(exact.endsWith('…')).toBe(false);
  });
});

describe('classifyOptionStyle', () => {
  it("returns 'recommended' for the exact Phase 02 sentinel description='Recommended'", () => {
    expect(classifyOptionStyle({ value: 'a', label: 'A', description: 'Recommended' })).toBe(
      'recommended',
    );
  });

  it("returns 'default' when description is undefined", () => {
    expect(classifyOptionStyle({ value: 'a', label: 'A' })).toBe('default');
  });

  it("returns 'default' for any non-sentinel description string (e.g. 'Fastest option')", () => {
    // Sentinel-exact-match negative case (cross-cutting #3). Any other
    // non-undefined string MUST classify as 'default' — Phase 03 does
    // NOT widen the contract to "any non-undefined description = recommended".
    expect(classifyOptionStyle({ value: 'a', label: 'A', description: 'Fastest option' })).toBe(
      'default',
    );
  });

  it("returns 'default' for an empty-string description (defensive — not the sentinel)", () => {
    expect(classifyOptionStyle({ value: 'a', label: 'A', description: '' })).toBe('default');
  });
});
