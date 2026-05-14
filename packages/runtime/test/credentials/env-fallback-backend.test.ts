/**
 * Phase 1 / plan 01-02 — unit tests for `createEnvFallbackBackend`.
 *
 * The env-fallback backend is the READ-ONLY headless path (Risk 4). These
 * tests use `vi.stubEnv` for env vars and snapshot/restore the env around each
 * test (mirroring `env.test.ts`'s `beforeEach`/`afterEach` + `vi.unstubAllEnvs`)
 * so a failing test cannot poison siblings in the same vitest worker. No
 * native module, no real keychain.
 *
 * Coverage:
 *  1. getSecret resolves a stubbed <PROVIDER>_API_KEY.
 *  2. getSecret returns undefined when no relevant env var is set.
 *  3. getSecret returns undefined for an oauth account even with the API key set.
 *  4. setSecret rejects with a "Keychain unavailable" error naming the env var.
 *  5. deleteSecret rejects with the same clear error.
 *  6. listAccounts includes a provider with a stubbed key, omits an unset one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvFallbackBackend } from '../../src/credentials/env-fallback-backend.js';
import { encodeAccount } from '../../src/credentials/namespace.js';

describe('@swt-labs/runtime — createEnvFallbackBackend (Plan 01-02)', () => {
  // Snapshot the API-key env vars these tests touch so a failing test cannot
  // leak state into sibling test files in the same worker.
  let savedAnthropic: string | undefined;
  let savedOpenai: string | undefined;
  let savedGoogle: string | undefined;

  beforeEach(() => {
    savedAnthropic = process.env.ANTHROPIC_API_KEY;
    savedOpenai = process.env.OPENAI_API_KEY;
    savedGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('ANTHROPIC_API_KEY', savedAnthropic);
    restore('OPENAI_API_KEY', savedOpenai);
    restore('GOOGLE_API_KEY', savedGoogle);
  });

  it('getSecret resolves a stubbed <PROVIDER>_API_KEY env var', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const backend = createEnvFallbackBackend();
    const secret = await backend.getSecret(encodeAccount('anthropic', 'api_key'));
    expect(secret).toBe('sk-ant-test');
  });

  it('getSecret returns undefined when no relevant env var is set', async () => {
    const backend = createEnvFallbackBackend();
    const secret = await backend.getSecret(encodeAccount('openai', 'api_key'));
    expect(secret).toBeUndefined();
  });

  it('getSecret returns undefined for an oauth account even with the API key set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const backend = createEnvFallbackBackend();
    // OAuth tokens are never in env vars — the oauth authMode always resolves
    // to undefined, mirroring pi-ai's getEnvApiKey exclusion.
    const secret = await backend.getSecret(encodeAccount('anthropic', 'oauth'));
    expect(secret).toBeUndefined();
  });

  it('setSecret rejects with a clear "Keychain unavailable" error naming the env var', async () => {
    const backend = createEnvFallbackBackend();
    await expect(backend.setSecret(encodeAccount('openai', 'api_key'), 'x')).rejects.toThrow(
      /Keychain unavailable/,
    );
    // The message must name the exact env var the operator should set.
    await expect(backend.setSecret(encodeAccount('openai', 'api_key'), 'x')).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('deleteSecret rejects with the same clear "Keychain unavailable" error', async () => {
    const backend = createEnvFallbackBackend();
    await expect(backend.deleteSecret(encodeAccount('openai', 'api_key'))).rejects.toThrow(
      /Keychain unavailable/,
    );
  });

  it('listAccounts includes a provider with a stubbed key and omits an unset one', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const backend = createEnvFallbackBackend();
    const accounts = await backend.listAccounts();
    expect(accounts).toContain(encodeAccount('anthropic', 'api_key'));
    // OPENAI_API_KEY was deleted in beforeEach and not stubbed here.
    expect(accounts).not.toContain(encodeAccount('openai', 'api_key'));
  });
});
