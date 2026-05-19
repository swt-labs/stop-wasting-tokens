/**
 * Pure-helper coverage for `lib/model-helpers.ts`. The functions
 * previously lived file-private in `DashboardStatusline.tsx`; the
 * existing `dashboard-statusline.test.ts` still has `shortModelLabel`
 * assertions via the back-compat re-export (kept so this extraction is
 * a pure refactor for the statusline test). This file is the new
 * source-of-truth test for both helpers — `compactTokens` had no direct
 * unit coverage before extraction.
 */

import { describe, expect, it } from 'vitest';

import { compactTokens, shortModelLabel } from '../src/client/lib/model-helpers.js';

describe('shortModelLabel', () => {
  it('strips the `claude-` prefix for Anthropic ids', () => {
    expect(shortModelLabel('claude-sonnet-4-6')).toBe('sonnet-4-6');
    expect(shortModelLabel('claude-opus-4-7')).toBe('opus-4-7');
    expect(shortModelLabel('claude-haiku-4-5-20251001')).toBe('haiku-4-5-20251001');
  });

  it('returns non-Anthropic ids unchanged', () => {
    expect(shortModelLabel('gpt-5-codex')).toBe('gpt-5-codex');
    expect(shortModelLabel('llama3.1:8b')).toBe('llama3.1:8b');
    expect(shortModelLabel('moonshotai/kimi-k2')).toBe('moonshotai/kimi-k2');
    expect(shortModelLabel('deepseek-chat')).toBe('deepseek-chat');
  });

  it('renders an em-dash for null / undefined / empty', () => {
    expect(shortModelLabel(null)).toBe('—');
    expect(shortModelLabel(undefined)).toBe('—');
    expect(shortModelLabel('')).toBe('—');
  });
});

describe('compactTokens', () => {
  it('renders exact integers below 1K', () => {
    expect(compactTokens(0)).toBe('0');
    expect(compactTokens(1)).toBe('1');
    expect(compactTokens(42)).toBe('42');
    expect(compactTokens(999)).toBe('999');
  });

  it('renders `NK` from 1K up to (but not including) 1M', () => {
    expect(compactTokens(1_000)).toBe('1K');
    expect(compactTokens(1_500)).toBe('1K'); // floor, not round
    expect(compactTokens(12_345)).toBe('12K');
    expect(compactTokens(999_999)).toBe('999K');
  });

  it('renders `NM` from 1M up', () => {
    expect(compactTokens(1_000_000)).toBe('1M');
    expect(compactTokens(2_999_999)).toBe('2M'); // floor
    expect(compactTokens(50_000_000)).toBe('50M');
  });

  it('renders em-dash for null / undefined / NaN', () => {
    expect(compactTokens(null)).toBe('—');
    expect(compactTokens(undefined)).toBe('—');
    expect(compactTokens(Number.NaN)).toBe('—');
  });

  it('floors (does not round) to avoid overstating counts', () => {
    // 12_999 floors to 12K. If we rounded, 12_500 → 13K would mislead.
    expect(compactTokens(12_999)).toBe('12K');
    expect(compactTokens(12_500)).toBe('12K');
  });
});
