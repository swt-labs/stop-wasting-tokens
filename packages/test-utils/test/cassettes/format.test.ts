import { describe, expect, it } from 'vitest';

import { CassetteHeaderSchema, CassetteInteractionSchema } from '../../src/cassettes/index.js';

describe('cassette format schemas', () => {
  describe('CassetteHeaderSchema', () => {
    it('validates a well-formed header', () => {
      const header = {
        schema_version: 1,
        type: 'header',
        name: 'scout-read-readme',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        recorded_at: '2026-05-11T22:00:00.000Z',
        cwd_redacted: true,
      };
      expect(() => CassetteHeaderSchema.parse(header)).not.toThrow();
    });

    it('rejects a header with cwd_redacted: false (cassette must be sealed)', () => {
      const header = {
        schema_version: 1,
        type: 'header',
        name: 'scout-read-readme',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        recorded_at: '2026-05-11T22:00:00.000Z',
        cwd_redacted: false,
      };
      expect(() => CassetteHeaderSchema.parse(header)).toThrow();
    });

    it('accepts optional usage totals when recorded', () => {
      const header = {
        schema_version: 1,
        type: 'header',
        name: 'scout-read-readme',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        recorded_at: '2026-05-11T22:00:00.000Z',
        cwd_redacted: true,
        usage: {
          input: 512,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
        },
      };
      expect(() => CassetteHeaderSchema.parse(header)).not.toThrow();
    });

    it('rejects negative token counts in usage', () => {
      const header = {
        schema_version: 1,
        type: 'header',
        name: 'scout-read-readme',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        recorded_at: '2026-05-11T22:00:00.000Z',
        cwd_redacted: true,
        usage: {
          input: -1,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
        },
      };
      expect(() => CassetteHeaderSchema.parse(header)).toThrow();
    });
  });

  describe('CassetteInteractionSchema', () => {
    it('validates a well-formed interaction', () => {
      const interaction = {
        schema_version: 1,
        type: 'interaction',
        seq: 1,
        request: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers_normalized: { 'content-type': 'application/json' },
          body_hash: 'sha256:' + 'a'.repeat(64),
        },
        response: {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body_chunks: [{ type: 'message_start' }, { type: 'content_block_start' }],
        },
      };
      expect(() => CassetteInteractionSchema.parse(interaction)).not.toThrow();
    });

    it('rejects a body_hash that is not sha256-prefixed hex', () => {
      const interaction = {
        schema_version: 1,
        type: 'interaction',
        seq: 1,
        request: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers_normalized: {},
          body_hash: 'md5:abc123',
        },
        response: { status: 200, headers: {}, body_chunks: [] },
      };
      expect(() => CassetteInteractionSchema.parse(interaction)).toThrow();
    });

    it('rejects a seq <= 0', () => {
      const interaction = {
        schema_version: 1,
        type: 'interaction',
        seq: 0,
        request: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers_normalized: {},
          body_hash: 'sha256:' + 'a'.repeat(64),
        },
        response: { status: 200, headers: {}, body_chunks: [] },
      };
      expect(() => CassetteInteractionSchema.parse(interaction)).toThrow();
    });
  });
});
