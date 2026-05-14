import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  OAuthStartBodySchema,
  OAuthManualCodeBodySchema,
  OAuthStartResponseSchema,
  OAuthManualCodeResponseSchema,
} from '../src/schemas/api.js';

/**
 * Plan 04-01 (Phase 4) T4 — unit tests for the OAuth route wire schemas
 * `@swt-labs/shared` ships in T2.
 *
 * The load-bearing piece is `collectKeys` — a recursive walk of every
 * schema's `.shape` that makes "no OAuth route schema (request OR response)
 * round-trips a secret" a CI-enforced STRUCTURAL invariant. OAuth's
 * `OAuthCredentials` blob is produced server-side by pi-ai and goes straight
 * to the keychain — it never travels the wire to or from the SPA.
 */

/** Field names that would indicate a secret riding the OAuth route wire. */
const SECRET_KEY_PATTERN = /secret|apikey|api_key|access|refresh|token|credential|password|^key$/i;

/**
 * Recursively collect every object-field name reachable from a Zod schema.
 * Handles the structural wrappers the OAuth route schemas actually use:
 * `ZodObject` (recurse `.shape`), `ZodArray` (recurse the element schema),
 * `ZodOptional` / `ZodNullable` (unwrap the inner schema), `ZodUnion`
 * (recurse every option). Anything else is a leaf and contributes no keys.
 */
function collectKeys(schema: z.ZodTypeAny, acc: string[] = []): string[] {
  const def = schema._def as { typeName?: string };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const [key, child] of Object.entries(shape)) {
        acc.push(key);
        collectKeys(child as z.ZodTypeAny, acc);
      }
      return acc;
    }
    case 'ZodArray':
      return collectKeys((schema as z.ZodArray<z.ZodTypeAny>).element, acc);
    case 'ZodOptional':
      return collectKeys((schema as z.ZodOptional<z.ZodTypeAny>).unwrap(), acc);
    case 'ZodNullable':
      return collectKeys((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), acc);
    case 'ZodUnion': {
      const options = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def
        .options as readonly z.ZodTypeAny[];
      for (const opt of options) collectKeys(opt, acc);
      return acc;
    }
    default:
      // ZodString / ZodBoolean / ZodEnum / ZodNull / ZodLiteral / … — leaf.
      return acc;
  }
}

describe('@swt-labs/shared — OAuth route wire schemas (Plan 04-01)', () => {
  describe('OAuthStartBodySchema', () => {
    it("parses { provider: 'anthropic' }", () => {
      expect(OAuthStartBodySchema.safeParse({ provider: 'anthropic' }).success).toBe(true);
    });

    it('rejects {} (missing provider)', () => {
      expect(OAuthStartBodySchema.safeParse({}).success).toBe(false);
    });

    it('rejects an inbound secret field (.strict())', () => {
      expect(
        OAuthStartBodySchema.safeParse({ provider: 'anthropic', apiKey: 'sk-x' }).success,
      ).toBe(false);
    });

    it('rejects an empty provider', () => {
      expect(OAuthStartBodySchema.safeParse({ provider: '' }).success).toBe(false);
    });
  });

  describe('OAuthManualCodeBodySchema', () => {
    it("parses { flow_id: 'f1', code: 'abc123' }", () => {
      expect(
        OAuthManualCodeBodySchema.safeParse({ flow_id: 'f1', code: 'abc123' }).success,
      ).toBe(true);
    });

    it('rejects a body missing code', () => {
      expect(OAuthManualCodeBodySchema.safeParse({ flow_id: 'f1' }).success).toBe(false);
    });

    it('rejects a body missing flow_id', () => {
      expect(OAuthManualCodeBodySchema.safeParse({ code: 'abc' }).success).toBe(false);
    });

    it('rejects an unknown extra field (.strict())', () => {
      expect(
        OAuthManualCodeBodySchema.safeParse({ flow_id: 'f1', code: 'abc', extra: 'x' }).success,
      ).toBe(false);
    });
  });

  describe('OAuthStartResponseSchema', () => {
    const fullResponse = {
      ok: true as const,
      flow_id: 'f1',
      provider: 'anthropic',
      started_at: '2026-05-14T00:00:00.000Z',
    };

    it('parses a full valid response', () => {
      expect(OAuthStartResponseSchema.safeParse(fullResponse).success).toBe(true);
    });

    it('rejects a response missing flow_id', () => {
      const { flow_id: _omit, ...missing } = fullResponse;
      void _omit;
      expect(OAuthStartResponseSchema.safeParse(missing).success).toBe(false);
    });

    it('rejects a non-ISO started_at', () => {
      expect(
        OAuthStartResponseSchema.safeParse({ ...fullResponse, started_at: 'yesterday' }).success,
      ).toBe(false);
    });
  });

  describe('OAuthManualCodeResponseSchema', () => {
    it("parses { ok: true, flow_id: 'f1' }", () => {
      expect(
        OAuthManualCodeResponseSchema.safeParse({ ok: true, flow_id: 'f1' }).success,
      ).toBe(true);
    });

    it('rejects { ok: false, flow_id: \'f1\' } (ok is z.literal(true))', () => {
      expect(
        OAuthManualCodeResponseSchema.safeParse({ ok: false, flow_id: 'f1' }).success,
      ).toBe(false);
    });
  });

  describe('no-secret-key structural walk — all four OAuth route schemas', () => {
    const ALL = {
      OAuthStartBodySchema,
      OAuthManualCodeBodySchema,
      OAuthStartResponseSchema,
      OAuthManualCodeResponseSchema,
    } as const;

    for (const [name, schema] of Object.entries(ALL)) {
      it(`${name}: no key matches the secret pattern at any nesting level`, () => {
        const keys = collectKeys(schema);
        // Sanity: the walk actually descended into the schema's shape.
        expect(keys.length).toBeGreaterThan(0);
        const offenders = keys.filter((k) => SECRET_KEY_PATTERN.test(k));
        expect(offenders).toEqual([]);
      });
    }

    it('the walk DOES catch a secret-shaped key when one is present (guard is real)', () => {
      // A negative control: prove SECRET_KEY_PATTERN + collectKeys would
      // actually flag a leak — so the green assertions above are meaningful.
      const leaky = z.object({ flow_id: z.string(), refresh: z.string() });
      const keys = collectKeys(leaky);
      expect(keys.filter((k) => SECRET_KEY_PATTERN.test(k))).toEqual(['refresh']);
    });
  });
});
