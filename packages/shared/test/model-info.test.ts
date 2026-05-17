/**
 * `@swt-labs/shared/types/model-info` — Statusline-extension milestone Step 3.
 *
 * Coverage matrix per artifacts.md §D:
 *   - Known Anthropic ids (4.x family, including the `[1m]` variants).
 *   - Known OpenAI Codex / GPT-5 ids.
 *   - Known ollama community ids.
 *   - Unknown / empty / null / undefined inputs return null.
 *   - KNOWN_MODEL_IDS exposes every key in the table (defence against
 *     accidental drift between the const and the export).
 */

import { describe, expect, it } from 'vitest';

import { KNOWN_MODEL_IDS, getContextWindow } from '../src/types/model-info.js';

describe('getContextWindow', () => {
  it('returns the documented window for Anthropic Claude 4.x ids', () => {
    expect(getContextWindow('claude-opus-4-7')).toBe(200_000);
    expect(getContextWindow('claude-opus-4-7[1m]')).toBe(1_000_000);
    expect(getContextWindow('claude-sonnet-4-6')).toBe(200_000);
    expect(getContextWindow('claude-sonnet-4-6[1m]')).toBe(1_000_000);
    expect(getContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(getContextWindow('claude-haiku-4-5-20251001')).toBe(200_000);
  });

  it('returns the documented window for OpenAI Codex / GPT-5 ids', () => {
    expect(getContextWindow('gpt-5')).toBe(400_000);
    expect(getContextWindow('gpt-5-mini')).toBe(400_000);
    expect(getContextWindow('gpt-5-nano')).toBe(400_000);
    expect(getContextWindow('gpt-5-codex')).toBe(400_000);
  });

  it('returns the documented window for ollama community ids', () => {
    expect(getContextWindow('llama3.1:8b')).toBe(128_000);
    expect(getContextWindow('llama3.1:70b')).toBe(128_000);
    expect(getContextWindow('qwen2.5-coder:32b')).toBe(128_000);
  });

  it('returns null for unknown model ids', () => {
    expect(getContextWindow('claude-fake-99')).toBeNull();
    expect(getContextWindow('gpt-9-quantum')).toBeNull();
    expect(getContextWindow('not-a-model')).toBeNull();
  });

  it('returns null for null, undefined, and empty string', () => {
    expect(getContextWindow(null)).toBeNull();
    expect(getContextWindow(undefined)).toBeNull();
    expect(getContextWindow('')).toBeNull();
  });

  it('is case-sensitive (vendor ids are canonical)', () => {
    // Capitalisation drift is a real-world hazard — keep the table strict.
    expect(getContextWindow('Claude-Opus-4-7')).toBeNull();
    expect(getContextWindow('GPT-5')).toBeNull();
  });
});

describe('KNOWN_MODEL_IDS', () => {
  it('exposes every key in the underlying table (no drift)', () => {
    // If the table grows, the const grows automatically via Object.keys.
    expect(KNOWN_MODEL_IDS.length).toBeGreaterThan(0);
    // Every advertised id must resolve to a non-null window.
    for (const id of KNOWN_MODEL_IDS) {
      expect(getContextWindow(id)).toBeGreaterThan(0);
    }
  });

  it('is read-only (frozen array)', () => {
    expect(Object.isFrozen(KNOWN_MODEL_IDS)).toBe(true);
  });
});
