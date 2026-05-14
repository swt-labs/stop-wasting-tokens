import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PROVIDER_VOCABULARY,
  ProviderAuthModeSchema,
  ProviderAuthSnapshotSchema,
  ProviderAuthStatusSchema,
  ProviderAuthUpdateBodySchema,
  ProviderAuthUpdateResponseSchema,
} from '../src/schemas/api.js';

/**
 * Plan 03-01 (Phase 3) T3 — unit tests for the `provider-auth` wire
 * contract `@swt-labs/shared` ships in T1/T2.
 *
 * The load-bearing piece is `collectKeys` — a recursive walk of every
 * schema's `.shape` that makes "no response/status/snapshot schema
 * round-trips a secret" a CI-enforced STRUCTURAL invariant, not a
 * reviewer-discipline convention. `apiKey` is permitted on exactly one
 * schema (`ProviderAuthUpdateBodySchema`, the inbound POST body); every
 * other schema is asserted secret-free at every nesting level.
 */

/** Field names that would indicate a secret round-tripping to the client. */
const SECRET_KEY_PATTERN = /secret|apikey|api_key|token|password|^key$/i;

/**
 * Recursively collect every object-field name reachable from a Zod schema.
 * Handles the structural wrappers the provider-auth schemas actually use:
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

describe('@swt-labs/shared — provider-auth wire schemas (Plan 03-01)', () => {
  describe('PROVIDER_VOCABULARY', () => {
    it('is a non-empty array including anthropic and openai', () => {
      expect(Array.isArray(PROVIDER_VOCABULARY)).toBe(true);
      expect(PROVIDER_VOCABULARY.length).toBeGreaterThan(0);
      expect(PROVIDER_VOCABULARY).toContain('anthropic');
      expect(PROVIDER_VOCABULARY).toContain('openai');
    });

    it('has no duplicate entries', () => {
      expect(new Set(PROVIDER_VOCABULARY).size).toBe(PROVIDER_VOCABULARY.length);
    });

    it('every entry is a non-empty lowercase string', () => {
      for (const id of PROVIDER_VOCABULARY) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        expect(id).toBe(id.toLowerCase());
      }
    });
  });

  describe('ProviderAuthModeSchema', () => {
    it("parses 'api_key' and 'oauth'", () => {
      expect(ProviderAuthModeSchema.parse('api_key')).toBe('api_key');
      expect(ProviderAuthModeSchema.parse('oauth')).toBe('oauth');
    });

    it("rejects 'bogus'", () => {
      expect(ProviderAuthModeSchema.safeParse('bogus').success).toBe(false);
    });
  });

  describe('ProviderAuthUpdateBodySchema', () => {
    it('parses an api_key body with a key', () => {
      const r = ProviderAuthUpdateBodySchema.safeParse({
        provider: 'openai',
        authMode: 'api_key',
        apiKey: 'sk-x',
      });
      expect(r.success).toBe(true);
    });

    it('parses an oauth body with no apiKey (valid — the key is omitted)', () => {
      const r = ProviderAuthUpdateBodySchema.safeParse({
        provider: 'openai',
        authMode: 'oauth',
      });
      expect(r.success).toBe(true);
    });

    it('rejects an empty provider', () => {
      expect(
        ProviderAuthUpdateBodySchema.safeParse({ provider: '', authMode: 'api_key' }).success,
      ).toBe(false);
    });

    it('rejects an empty apiKey when the field is present', () => {
      expect(
        ProviderAuthUpdateBodySchema.safeParse({
          provider: 'openai',
          authMode: 'api_key',
          apiKey: '',
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown extra field (.strict())', () => {
      expect(
        ProviderAuthUpdateBodySchema.safeParse({
          provider: 'openai',
          authMode: 'api_key',
          extra: 'x',
        }).success,
      ).toBe(false);
    });
  });

  describe('ProviderAuthStatusSchema', () => {
    it('parses a fully-configured status', () => {
      const r = ProviderAuthStatusSchema.safeParse({
        provider: 'openai',
        configured: true,
        mode: 'api_key',
        source: 'keychain',
        label: 'Keychain',
      });
      expect(r.success).toBe(true);
    });

    it('parses a not-configured status (all nullable fields null)', () => {
      const r = ProviderAuthStatusSchema.safeParse({
        provider: 'openai',
        configured: false,
        mode: null,
        source: null,
        label: null,
      });
      expect(r.success).toBe(true);
    });

    it('has no key matching the secret pattern at any nesting level', () => {
      const keys = collectKeys(ProviderAuthStatusSchema);
      const offenders = keys.filter((k) => SECRET_KEY_PATTERN.test(k));
      expect(offenders).toEqual([]);
    });
  });

  describe('no-secret-key structural walk — response/snapshot schemas', () => {
    it('ProviderAuthSnapshotSchema has no secret-shaped key (recurses statuses[])', () => {
      const keys = collectKeys(ProviderAuthSnapshotSchema);
      // Sanity: the walk actually descended into the statuses array element.
      expect(keys).toContain('statuses');
      expect(keys).toContain('configured');
      const offenders = keys.filter((k) => SECRET_KEY_PATTERN.test(k));
      expect(offenders).toEqual([]);
    });

    it('ProviderAuthUpdateResponseSchema has no secret-shaped key (recurses snapshot{})', () => {
      const keys = collectKeys(ProviderAuthUpdateResponseSchema);
      // Sanity: the walk actually descended into the nested snapshot object.
      expect(keys).toContain('snapshot');
      expect(keys).toContain('statuses');
      const offenders = keys.filter((k) => SECRET_KEY_PATTERN.test(k));
      expect(offenders).toEqual([]);
    });

    it('the walk DOES catch a secret-shaped key when one is present (guard is real)', () => {
      // A negative control: prove SECRET_KEY_PATTERN + collectKeys would
      // actually flag a leak — so the green assertions above are meaningful.
      const leaky = z.object({ snapshot: z.object({ apiKey: z.string() }) });
      const keys = collectKeys(leaky);
      expect(keys.filter((k) => SECRET_KEY_PATTERN.test(k))).toEqual(['apiKey']);
    });
  });

  describe('ProviderAuthSnapshotSchema full parse', () => {
    const fullSnapshot = {
      selected_provider: 'anthropic',
      strategy_kind: 'pinned',
      keychain_available: true,
      keychain_reason: null,
      statuses: [
        {
          provider: 'anthropic',
          configured: true,
          mode: 'api_key' as const,
          source: 'keychain' as const,
          label: 'Keychain',
        },
      ],
      generated_at: '2026-05-14T00:00:00.000Z',
    };

    it('parses a complete valid snapshot', () => {
      expect(ProviderAuthSnapshotSchema.safeParse(fullSnapshot).success).toBe(true);
    });

    it('rejects a snapshot missing keychain_available', () => {
      const { keychain_available: _omit, ...missing } = fullSnapshot;
      void _omit;
      expect(ProviderAuthSnapshotSchema.safeParse(missing).success).toBe(false);
    });
  });
});
