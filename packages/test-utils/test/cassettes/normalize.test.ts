import { describe, expect, it } from 'vitest';

import {
  canonicalizeJson,
  hashRequest,
  normalizeHeaders,
  normalizeRequest,
  stripCwd,
  normalizeCacheControl,
} from '../../src/cassettes/index.js';

describe('cassette normalisation + hashing', () => {
  describe('normalizeHeaders', () => {
    it('lowercases keys and sorts deterministically', () => {
      const result = normalizeHeaders({
        'X-Custom': 'foo',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      expect(Object.keys(result)).toEqual(['accept', 'content-type', 'x-custom']);
    });

    it('strips authorization and other sensitive headers', () => {
      const result = normalizeHeaders({
        Authorization: 'Bearer sk-secret-token',
        'X-API-Key': 'real-key',
        Cookie: 'session=abc',
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-123',
      });
      expect(result).toEqual({ 'content-type': 'application/json' });
    });

    it('joins multi-value headers with comma', () => {
      const result = normalizeHeaders({ 'Set-Cookie': ['a=1', 'b=2'] });
      // set-cookie is in the sensitive list and should be stripped
      expect(result).toEqual({});
    });
  });

  describe('canonicalizeJson', () => {
    it('sorts object keys recursively', () => {
      const obj = { b: 1, a: { z: 1, y: 2 }, c: [1, 2, 3] };
      const canonical = canonicalizeJson(obj);
      expect(canonical).toBe('{"a":{"y":2,"z":1},"b":1,"c":[1,2,3]}');
    });

    it('preserves array order (semantically significant)', () => {
      const obj = { messages: [{ role: 'user' }, { role: 'assistant' }] };
      const canonical = canonicalizeJson(obj);
      expect(canonical).toBe('{"messages":[{"role":"user"},{"role":"assistant"}]}');
    });
  });

  describe('stripCwd', () => {
    it('replaces absolute cwd paths with <cwd> placeholder', () => {
      const body = {
        prompt: 'Read /Users/alice/projects/swt/README.md',
        files: ['/Users/alice/projects/swt/src/x.ts'],
      };
      const stripped = stripCwd(body, '/Users/alice/projects/swt');
      expect(stripped).toEqual({
        prompt: 'Read <cwd>/README.md',
        files: ['<cwd>/src/x.ts'],
      });
    });

    it('passes through values that do not contain the cwd', () => {
      const body = { a: 1, b: 'hello', c: null };
      expect(stripCwd(body, '/some/cwd')).toEqual(body);
    });
  });

  describe('normalizeCacheControl', () => {
    it('canonicalises Anthropic cache_control markers to {type: ephemeral}', () => {
      const body = {
        system: [
          { type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral', ttl: '5m' } },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
          },
        ],
      };
      const normalized = normalizeCacheControl(body) as Record<string, unknown>;
      const system = normalized['system'] as Array<Record<string, unknown>>;
      expect(system[0]?.['cache_control']).toEqual({ type: 'ephemeral' });
    });

    it('passes through non-Anthropic bodies unchanged', () => {
      const body = { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] };
      expect(normalizeCacheControl(body)).toEqual(body);
    });
  });

  describe('normalizeRequest + hashRequest', () => {
    it('produces deterministic hash for the same logical request', () => {
      const cwd = '/Users/alice/projects/swt';
      const r1 = normalizeRequest(
        'POST',
        'https://api.anthropic.com/v1/messages',
        { 'Content-Type': 'application/json', Authorization: 'Bearer xyz' },
        { messages: [{ role: 'user', content: `read ${cwd}/README.md` }] },
        { cwd },
      );
      const r2 = normalizeRequest(
        'POST',
        'https://api.anthropic.com/v1/messages',
        { 'content-type': 'application/json', Authorization: 'Bearer different-token' },
        { messages: [{ role: 'user', content: `read ${cwd}/README.md` }] },
        { cwd },
      );
      expect(hashRequest(r1)).toBe(hashRequest(r2));
      expect(hashRequest(r1)).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces different hashes for semantically different requests', () => {
      const r1 = normalizeRequest(
        'POST',
        'https://api.anthropic.com/v1/messages',
        {},
        { messages: [{ role: 'user', content: 'hello' }] },
      );
      const r2 = normalizeRequest(
        'POST',
        'https://api.anthropic.com/v1/messages',
        {},
        { messages: [{ role: 'user', content: 'goodbye' }] },
      );
      expect(hashRequest(r1)).not.toBe(hashRequest(r2));
    });
  });
});
