/**
 * `getGeminiTosWarning` tests per Plan 05-01 PR-40.
 */

import { describe, expect, it } from 'vitest';

import { getGeminiTosWarning, getProviderWarning } from '../../src/providers/gemini-warnings.js';

describe('getGeminiTosWarning (M5 PR-40)', () => {
  it('returns a structured warning for gemini-2.5-pro', () => {
    const warning = getGeminiTosWarning('gemini-2.5-pro');
    expect(warning).not.toBeNull();
    expect(warning?.severity).toBe('info');
    expect(warning?.tos_url).toContain('ai.google.dev/terms');
    expect(warning?.training_opt_out_url).toContain('console.cloud.google.com');
    expect(warning?.message).toContain('training');
    expect(warning?.data_retention_note).toContain('Vertex AI');
  });

  it('returns a warning for gemini-2.5-flash (cheap-fast tier)', () => {
    const warning = getGeminiTosWarning('gemini-2.5-flash');
    expect(warning).not.toBeNull();
    expect(warning?.severity).toBe('info');
  });

  it('is case-insensitive on the model prefix', () => {
    expect(getGeminiTosWarning('Gemini-2.5-Pro')).not.toBeNull();
    expect(getGeminiTosWarning('GEMINI-2.5-FLASH')).not.toBeNull();
    expect(getGeminiTosWarning('  gemini-2.5-pro  ')).not.toBeNull();
  });

  it('returns null for non-Gemini models', () => {
    expect(getGeminiTosWarning('claude-opus-4-7')).toBeNull();
    expect(getGeminiTosWarning('gpt-5')).toBeNull();
    expect(getGeminiTosWarning('deepseek/deepseek-v3')).toBeNull();
    expect(getGeminiTosWarning('llama3.3:70b')).toBeNull();
  });

  it('returns null for empty / whitespace-only model IDs', () => {
    expect(getGeminiTosWarning('')).toBeNull();
    expect(getGeminiTosWarning('   ')).toBeNull();
  });

  it('does NOT match partial substrings — model must start with gemini-', () => {
    expect(getGeminiTosWarning('my-gemini-model')).toBeNull();
    expect(getGeminiTosWarning('gemini2-pro')).toBeNull(); // missing hyphen
    expect(getGeminiTosWarning('gemini')).toBeNull(); // no hyphen at all
  });

  it('warning fields are all non-empty strings', () => {
    const warning = getGeminiTosWarning('gemini-2.5-pro');
    expect(warning).not.toBeNull();
    if (warning === null) return;
    expect(warning.message.length).toBeGreaterThan(0);
    expect(warning.tos_url.length).toBeGreaterThan(0);
    expect(warning.data_retention_note.length).toBeGreaterThan(0);
    expect(warning.training_opt_out_url.length).toBeGreaterThan(0);
    expect(warning.tos_url.startsWith('https://')).toBe(true);
    expect(warning.training_opt_out_url.startsWith('https://')).toBe(true);
  });
});

describe('getProviderWarning — convenience wrapper (M5 PR-40)', () => {
  it('returns the Gemini warning for Gemini models', () => {
    const g = getProviderWarning('gemini-2.5-pro');
    const direct = getGeminiTosWarning('gemini-2.5-pro');
    expect(g).toEqual(direct);
  });

  it('returns null for non-Gemini models (no warning for Anthropic / OpenAI)', () => {
    expect(getProviderWarning('claude-opus-4-7')).toBeNull();
    expect(getProviderWarning('gpt-5')).toBeNull();
  });
});
