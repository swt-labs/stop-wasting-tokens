/**
 * Plan 01-01 (Milestone 12) — unit suite for `readProjectAuthConfig` in
 * `@swt-labs/runtime`. Verifies the auth-block slice of `loadCookConfig` is
 * byte-identical for the auth key and preserves the same graceful-degrade
 * contract.
 *
 * Cases (≥3 — five here):
 *  1. Missing .swt-planning/config.json → returns DEFAULT_AUTH_CONFIG ({}).
 *  2. Valid config WITH an auth block → returns the parsed AuthConfig.
 *  3. Malformed JSON → returns DEFAULT_AUTH_CONFIG (graceful degrade).
 *  4. Valid config with NO auth block → returns DEFAULT_AUTH_CONFIG.
 *  5. Valid config with a malformed (non-object) auth value → returns
 *     DEFAULT_AUTH_CONFIG (parseAuthConfig's own defensive parser kicks in).
 *
 * `fsImpl` is the documented test seam — production callers omit it.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTH_CONFIG } from '../../src/credentials/auth-config.js';
import { readProjectAuthConfig } from '../../src/credentials/read-project-auth-config.js';

describe('readProjectAuthConfig', () => {
  it('(1) missing .swt-planning/config.json → returns DEFAULT_AUTH_CONFIG', () => {
    const fsImpl = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called on missing-file path');
      },
    } as unknown as Parameters<typeof readProjectAuthConfig>[1];

    const auth = readProjectAuthConfig('/whatever', fsImpl);

    expect(auth).toEqual({});
    expect(auth).toBe(DEFAULT_AUTH_CONFIG);
  });

  it('(2) valid config WITH an auth block → returns the parsed AuthConfig (full passthrough)', () => {
    const authBlock = {
      openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' },
      anthropic: { mode: 'oauth' },
    };
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          auto_uat: false,
          providers: { strategy: { kind: 'pinned', provider: 'openai' } },
          auth: authBlock,
        }),
    } as unknown as Parameters<typeof readProjectAuthConfig>[1];

    const auth = readProjectAuthConfig('/whatever', fsImpl);

    expect(auth).toEqual(authBlock);
    // The result is a fresh object — parseAuthConfig never returns by reference.
    expect(auth).not.toBe(authBlock);
  });

  it('(3) malformed JSON → returns DEFAULT_AUTH_CONFIG (graceful degrade, no throw)', () => {
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => '{ this is not valid json',
    } as unknown as Parameters<typeof readProjectAuthConfig>[1];

    expect(() => readProjectAuthConfig('/whatever', fsImpl)).not.toThrow();
    expect(readProjectAuthConfig('/whatever', fsImpl)).toEqual({});
  });

  it('(4) valid config with NO auth block → returns DEFAULT_AUTH_CONFIG', () => {
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ auto_uat: false }),
    } as unknown as Parameters<typeof readProjectAuthConfig>[1];

    const auth = readProjectAuthConfig('/whatever', fsImpl);

    expect(auth).toEqual({});
  });

  it('(5) valid config with a malformed (non-object) auth value → returns DEFAULT_AUTH_CONFIG', () => {
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ auto_uat: false, auth: 'not-an-object' }),
    } as unknown as Parameters<typeof readProjectAuthConfig>[1];

    const auth = readProjectAuthConfig('/whatever', fsImpl);

    expect(auth).toEqual({});
  });

  it('(6) defaults — production callers omit fsImpl; nonexistent project root degrades gracefully', () => {
    // Real filesystem read; the dir absolutely does not exist.
    const auth = readProjectAuthConfig(
      '/nonexistent-project-root-for-vbw-test-' + Math.random().toString(36).slice(2),
    );
    expect(auth).toEqual({});
  });
});
