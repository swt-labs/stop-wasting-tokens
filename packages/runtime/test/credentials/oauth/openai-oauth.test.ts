/**
 * Milestone 21 Phase 01 — runtime unit tests for the SWT ↔ pi-ai OAuth
 * provider-id mapping + the resulting end-to-end resolution through
 * pi-ai's OAuth registry.
 *
 * No network calls. No keychain writes. Pure imports against
 * @earendil-works/pi-ai/oauth's already-loaded built-in registry and
 * SWT's new provider-id-map module.
 */

import { getOAuthProvider } from '@earendil-works/pi-ai/oauth';
import type { OAuthProviderInterface } from '@earendil-works/pi-ai/oauth';
import { describe, expect, it } from 'vitest';

import {
  mapToOAuthProviderId,
  SWT_TO_PI_OAUTH_PROVIDER_ID,
} from '../../../src/credentials/oauth/provider-id-map.js';

describe('mapToOAuthProviderId (mapping table)', () => {
  it("maps 'openai' → 'openai-codex' (Research §1 — the only divergent id today)", () => {
    expect(mapToOAuthProviderId('openai')).toBe('openai-codex');
  });

  it("returns 'anthropic' verbatim (identity fallback — pi-ai's id matches SWT's)", () => {
    expect(mapToOAuthProviderId('anthropic')).toBe('anthropic');
  });

  it("returns 'github-copilot' verbatim (identity fallback)", () => {
    expect(mapToOAuthProviderId('github-copilot')).toBe('github-copilot');
  });

  it('returns unknown provider ids verbatim (identity fallback — never throws)', () => {
    expect(mapToOAuthProviderId('unknown-provider-xyz')).toBe('unknown-provider-xyz');
    expect(mapToOAuthProviderId('')).toBe('');
  });

  it('SWT_TO_PI_OAUTH_PROVIDER_ID is frozen (no runtime mutation)', () => {
    expect(Object.isFrozen(SWT_TO_PI_OAUTH_PROVIDER_ID)).toBe(true);
  });

  it('table has exactly one entry today (openai → openai-codex)', () => {
    expect(Object.keys(SWT_TO_PI_OAUTH_PROVIDER_ID)).toEqual(['openai']);
  });
});

describe('end-to-end resolution through pi-ai registry', () => {
  it("getOAuthProvider(mapToOAuthProviderId('openai')) resolves to the OpenAI Codex provider", () => {
    const provider = getOAuthProvider(mapToOAuthProviderId('openai'));
    expect(provider).not.toBeUndefined();
    expect(provider?.id).toBe('openai-codex');
  });

  it("getOAuthProvider('openai') WITHOUT mapping is undefined (this is the bug Phase 01 fixes)", () => {
    expect(getOAuthProvider('openai')).toBeUndefined();
  });

  it("getOAuthProvider(mapToOAuthProviderId('anthropic')) resolves to the Anthropic provider", () => {
    const provider = getOAuthProvider(mapToOAuthProviderId('anthropic'));
    expect(provider).not.toBeUndefined();
    expect(provider?.id).toBe('anthropic');
  });
});

describe('OAuthProviderInterface uniformity (Research §5 — DRIFT-3 resolved-non-issue assertion)', () => {
  it('Anthropic and OpenAI Codex providers expose the same OAuthProviderInterface keys', () => {
    const anthropic: OAuthProviderInterface | undefined = getOAuthProvider('anthropic');
    const openaiCodex: OAuthProviderInterface | undefined = getOAuthProvider('openai-codex');
    expect(anthropic).not.toBeUndefined();
    expect(openaiCodex).not.toBeUndefined();
    if (!anthropic || !openaiCodex) throw new Error('unreachable — guarded by expects above');

    // Both providers must expose the same OAuthProviderInterface shape so
    // `refreshOAuthCredentialsIfNeeded` / `runOAuthLoginFlow` dispatch
    // uniformly. If pi-ai ever diverges, this test surfaces it before
    // SWT ships a broken refresh path.
    const anthropicKeys = Object.keys(anthropic).sort();
    const openaiCodexKeys = Object.keys(openaiCodex).sort();
    expect(openaiCodexKeys).toEqual(anthropicKeys);
  });
});
