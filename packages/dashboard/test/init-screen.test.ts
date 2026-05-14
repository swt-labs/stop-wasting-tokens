/**
 * `<InitScreen>` provider-section coverage — the optional/skip gate + the
 * init→persist sequencing decision.
 *
 * The dashboard workspace has no Solid testing-library and vitest runs
 * `environment: 'node'` (see `options-menu.test.ts` / `provider-auth-panel.test.ts`).
 * The provider section's load-bearing logic is factored into the pure
 * exported helpers `hasProviderSelection` + `planProviderPersist`, which are
 * unit-tested directly here, plus a smoke test that `InitScreen` is a
 * callable Solid component.
 *
 * `planProviderPersist` is the heart of the init→persist sequencing: the
 * InitScreen calls `onInit` FIRST (the /api/provider-auth route + the `auth`
 * config block need `.swt-planning/` to exist), then — only on init success
 * — feeds the form state through this helper to decide whether to persist an
 * API key, kick off an OAuth flow, or do nothing (the skip path → init is
 * unchanged name+description-only behaviour).
 */

import { describe, expect, it } from 'vitest';

import {
  InitScreen,
  hasProviderSelection,
  planProviderPersist,
  type ProviderSelection,
} from '../src/client/components/InitScreen.jsx';

describe('<InitScreen>', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof InitScreen).toBe('function');
  });
});

/* ── hasProviderSelection — the optional/skip gate ────────────────────── */

describe('hasProviderSelection', () => {
  it('api_key mode with a non-empty key counts as a selection', () => {
    expect(hasProviderSelection({ provider: 'anthropic', mode: 'api_key', apiKey: 'sk-abc' })).toBe(
      true,
    );
  });

  it('api_key mode with an empty key is a SKIP (the section is optional)', () => {
    expect(hasProviderSelection({ provider: 'anthropic', mode: 'api_key', apiKey: '' })).toBe(
      false,
    );
  });

  it('api_key mode with a whitespace-only key is a SKIP', () => {
    expect(hasProviderSelection({ provider: 'anthropic', mode: 'api_key', apiKey: '   ' })).toBe(
      false,
    );
  });

  it('oauth mode with an OAuth-capable provider counts as a selection', () => {
    // anthropic / openai-codex / github-copilot have a pi-ai OAuth subsystem.
    expect(hasProviderSelection({ provider: 'anthropic', mode: 'oauth', apiKey: '' })).toBe(true);
    expect(hasProviderSelection({ provider: 'github-copilot', mode: 'oauth', apiKey: '' })).toBe(
      true,
    );
  });

  it('oauth mode with a non-OAuth provider is a SKIP (no pi-ai OAuth subsystem)', () => {
    expect(hasProviderSelection({ provider: 'deepseek', mode: 'oauth', apiKey: '' })).toBe(false);
    expect(hasProviderSelection({ provider: 'groq', mode: 'oauth', apiKey: '' })).toBe(false);
  });
});

/* ── planProviderPersist — the init→persist sequencing decision ───────── */

describe('planProviderPersist', () => {
  it('returns {kind:"skip"} when the section was left untouched (empty api key)', () => {
    const sel: ProviderSelection = { provider: 'anthropic', mode: 'api_key', apiKey: '' };
    expect(planProviderPersist(sel)).toEqual({ kind: 'skip' });
  });

  it('returns {kind:"skip"} for oauth mode on a non-OAuth provider', () => {
    const sel: ProviderSelection = { provider: 'deepseek', mode: 'oauth', apiKey: '' };
    expect(planProviderPersist(sel)).toEqual({ kind: 'skip' });
  });

  it('builds an api_key ProviderAuthUpdateBody with the TRIMMED key', () => {
    const sel: ProviderSelection = {
      provider: 'openai',
      mode: 'api_key',
      apiKey: '  sk-trim-me  ',
    };
    expect(planProviderPersist(sel)).toEqual({
      kind: 'api_key',
      body: { provider: 'openai', authMode: 'api_key', apiKey: 'sk-trim-me' },
    });
  });

  it('returns {kind:"oauth"} carrying the provider for an OAuth-capable selection', () => {
    const sel: ProviderSelection = {
      provider: 'github-copilot',
      mode: 'oauth',
      apiKey: '',
    };
    expect(planProviderPersist(sel)).toEqual({ kind: 'oauth', provider: 'github-copilot' });
  });

  it('the api_key body always carries authMode:"api_key" (never leaks oauth)', () => {
    const plan = planProviderPersist({
      provider: 'anthropic',
      mode: 'api_key',
      apiKey: 'sk-x',
    });
    expect(plan.kind).toBe('api_key');
    if (plan.kind === 'api_key') {
      expect(plan.body.authMode).toBe('api_key');
    }
  });
});
