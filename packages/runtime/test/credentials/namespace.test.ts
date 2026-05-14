import { describe, expect, it } from 'vitest';

import type { AuthMode } from '../../src/credentials/types.js';
import {
  SWT_KEYCHAIN_SERVICE,
  decodeAccount,
  encodeAccount,
} from '../../src/credentials/namespace.js';

describe('@swt-labs/runtime — credentials/namespace codec (Plan 01-01)', () => {
  describe('SWT_KEYCHAIN_SERVICE', () => {
    it("is the constant 'swt' (research §6 — the keychain `service` half)", () => {
      expect(SWT_KEYCHAIN_SERVICE).toBe('swt');
    });
  });

  describe('encodeAccount()', () => {
    it("encodes (provider, authMode) -> '<provider>:<authMode>'", () => {
      expect(encodeAccount('openai', 'api_key')).toBe('openai:api_key');
      expect(encodeAccount('anthropic', 'oauth')).toBe('anthropic:oauth');
    });

    it('throws on an empty-string provider', () => {
      expect(() => encodeAccount('', 'api_key')).toThrow();
    });

    it('throws on a whitespace-only provider', () => {
      expect(() => encodeAccount('   ', 'api_key')).toThrow();
    });

    it("throws on a provider containing ':' (collision prevention)", () => {
      expect(() => encodeAccount('openrouter:foo', 'api_key')).toThrow();
    });

    it('is deterministic — 10 identical calls return byte-identical strings', () => {
      const results = Array.from({ length: 10 }, () =>
        encodeAccount('openai', 'api_key'),
      );
      for (const r of results) {
        expect(r).toBe('openai:api_key');
      }
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('decodeAccount()', () => {
    it('decodes a well-formed account into a CredentialRef', () => {
      expect(decodeAccount('openai:api_key')).toEqual({
        provider: 'openai',
        authMode: 'api_key',
      });
    });

    it("throws on an account with no ':'", () => {
      expect(() => decodeAccount('no-colon')).toThrow();
    });

    it('throws on an account with an unknown authMode', () => {
      expect(() => decodeAccount('openai:bogus')).toThrow();
    });

    it('throws on an empty-string account', () => {
      expect(() => decodeAccount('')).toThrow();
    });
  });

  describe('round-trip', () => {
    const table: ReadonlyArray<readonly [string, AuthMode]> = [
      ['openai', 'api_key'],
      ['anthropic', 'oauth'],
      ['google', 'api_key'],
    ];

    for (const [provider, authMode] of table) {
      it(`decodeAccount(encodeAccount('${provider}', '${authMode}')) round-trips`, () => {
        expect(decodeAccount(encodeAccount(provider, authMode))).toEqual({
          provider,
          authMode,
        });
      });
    }
  });
});
