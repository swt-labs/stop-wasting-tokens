/**
 * Phase 2 / Plan 02-01 T3 — exhaustive unit coverage for `parseAuthConfig`,
 * the pure defensive parser for the additive `auth` config block.
 *
 * Asserts the full behaviour contract:
 *  (1) Malformed input (non-object / null / array / primitive) -> the empty
 *      DEFAULT_AUTH_CONFIG `{}`.
 *  (2) A valid full entry (`{mode, credentialRef}`) passes through verbatim.
 *  (3) An entry with `mode` only keeps `credentialRef` OMITTED as a key (not
 *      surfaced as `credentialRef: undefined`) so the 02-04 callsite can
 *      derive the default `swt:<provider>:<mode>`.
 *  (4) Per-entry drop rules — bad `mode`, empty / ':'-containing provider id,
 *      non-object entry — drop the offending pair while every valid pair
 *      survives.
 *  (5) A wrong-shape `credentialRef` (empty / whitespace / non-string) is
 *      omitted while `mode` is kept.
 *  (6) The result is a fresh object — never the input by reference.
 *  (7) Determinism — the same input parsed repeatedly is byte-identical.
 *  (8) No secret-shaped field ever surfaces on an entry — `parseAuthConfig`
 *      only ever emits `mode` + optional `credentialRef`, even when the input
 *      maliciously carries `secret` / `key` / `apiKey` / `token`.
 */

import { describe, expect, it } from 'vitest';

import { parseAuthConfig, DEFAULT_AUTH_CONFIG } from '../../src/commands/auth-config.js';

describe('parseAuthConfig', () => {
  it('returns DEFAULT_AUTH_CONFIG ({}) for malformed / non-object input', () => {
    expect(parseAuthConfig(undefined)).toEqual({});
    expect(parseAuthConfig(null)).toEqual({});
    expect(parseAuthConfig('string')).toEqual({});
    expect(parseAuthConfig(42)).toEqual({});
    expect(parseAuthConfig([])).toEqual({});
    expect(parseAuthConfig(true)).toEqual({});
    // And the exported default is itself the empty object.
    expect(DEFAULT_AUTH_CONFIG).toEqual({});
  });

  it('passes a valid full entry { mode, credentialRef } through verbatim', () => {
    expect(
      parseAuthConfig({
        openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' },
      }),
    ).toEqual({
      openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' },
    });
  });

  it('omits credentialRef as a key (not undefined-valued) when absent', () => {
    const result = parseAuthConfig({ openai: { mode: 'oauth' } });
    expect(result).toEqual({ openai: { mode: 'oauth' } });
    // Must be OMITTED as a key — so the 02-04 callsite can derive the default.
    expect('credentialRef' in result.openai).toBe(false);
  });

  it('accepts the oauth mode today (schema needs no Phase 4 churn)', () => {
    expect(parseAuthConfig({ anthropic: { mode: 'oauth' } })).toEqual({
      anthropic: { mode: 'oauth' },
    });
  });

  it('drops every invalid pair while valid pairs survive', () => {
    expect(
      parseAuthConfig({
        openai: { mode: 'api_key' },
        badmode: { mode: 'nope' },
        '': { mode: 'api_key' },
        'has:colon': { mode: 'api_key' },
        '   ': { mode: 'api_key' },
        nullentry: null,
        strentry: 'x',
        arrentry: [],
        numentry: 7,
      }),
    ).toEqual({ openai: { mode: 'api_key' } });
  });

  it('omits a wrong-shape credentialRef while keeping mode', () => {
    const badRefs: readonly unknown[] = ['', '   ', 123, null, {}, [], true];
    for (const credentialRef of badRefs) {
      expect(parseAuthConfig({ openai: { mode: 'api_key', credentialRef } })).toEqual({
        openai: { mode: 'api_key' },
      });
    }
  });

  it('returns a fresh object — never the input by reference', () => {
    const input = { openai: { mode: 'api_key' } };
    const result = parseAuthConfig(input);
    expect(result).not.toBe(input);
    // The nested entry is fresh too — never aliased to the input's entry.
    expect(result.openai).not.toBe(input.openai);
  });

  it('is deterministic — same input parsed 5x is byte-identical', () => {
    const input = {
      openai: { mode: 'api_key', credentialRef: 'swt:openai:api_key' },
      anthropic: { mode: 'oauth' },
    };
    const runs = Array.from({ length: 5 }, () => parseAuthConfig(input));
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('never surfaces a secret-shaped field on an entry', () => {
    const withRef = parseAuthConfig({
      openai: {
        mode: 'api_key',
        credentialRef: 'swt:openai:api_key',
        secret: 'sk-leak',
        key: 'sk-leak',
        apiKey: 'sk-leak',
        token: 'sk-leak',
      },
    });
    expect(Object.keys(withRef.openai).sort()).toEqual(['credentialRef', 'mode']);

    const withoutRef = parseAuthConfig({
      openai: {
        mode: 'oauth',
        secret: 'sk-leak',
        key: 'sk-leak',
        apiKey: 'sk-leak',
        token: 'sk-leak',
      },
    });
    expect(Object.keys(withoutRef.openai)).toEqual(['mode']);

    // Belt and braces: none of the secret-shaped keys leak in either case.
    for (const entry of [withRef.openai, withoutRef.openai]) {
      for (const forbidden of ['secret', 'key', 'apiKey', 'token']) {
        expect(forbidden in entry).toBe(false);
      }
    }
  });
});
