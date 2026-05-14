import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  OAuthAuthUrlEventSchema,
  OAuthProgressEventSchema,
  OAuthAwaitingCodeEventSchema,
  OAuthCompleteEventSchema,
  OAuthErrorEventSchema,
  SnapshotEventSchema,
  SNAPSHOT_EVENT_TYPES,
} from '../src/schemas/events.js';

/**
 * Plan 04-01 (Phase 4) T4 — unit tests for the `oauth.*` SSE event variants
 * `@swt-labs/shared` ships in T1.
 *
 * The load-bearing piece is `collectKeys` — a recursive walk of every event
 * schema's `.shape` that makes "no oauth.* event variant can transport a
 * token" a CI-enforced STRUCTURAL invariant, not a reviewer-discipline
 * convention. The `oauth.*` discriminated-union members are open (no
 * `.strict()` — that is the existing `events.ts` convention), so the real
 * invariant is the SCHEMA SHAPE: the `collectKeys` walk asserts no
 * secret-shaped key exists at any nesting level.
 */

/** Field names that would indicate a secret riding the SSE wire. */
const SECRET_KEY_PATTERN = /secret|apikey|api_key|token|access|refresh|credential|password|^key$/i;

/**
 * Recursively collect every object-field name reachable from a Zod schema.
 * Handles the structural wrappers the oauth.* event schemas actually use:
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
        collectKeys(child, acc);
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

const TS = '2026-05-14T00:00:00.000Z';

/** A valid representative payload per variant. */
const VALID = {
  'oauth.auth_url': {
    type: 'oauth.auth_url' as const,
    ts: TS,
    flow_id: 'f1',
    provider: 'anthropic',
    url: 'https://auth.anthropic.com/authorize?x=1',
    instructions: 'Open this URL in your browser.',
  },
  'oauth.progress': {
    type: 'oauth.progress' as const,
    ts: TS,
    flow_id: 'f1',
    provider: 'anthropic',
    message: 'Waiting for the browser callback…',
  },
  'oauth.awaiting_code': {
    type: 'oauth.awaiting_code' as const,
    ts: TS,
    flow_id: 'f1',
    provider: 'anthropic',
    message: 'Paste the authorization code below.',
  },
  'oauth.complete': {
    type: 'oauth.complete' as const,
    ts: TS,
    flow_id: 'f1',
    provider: 'anthropic',
  },
  'oauth.error': {
    type: 'oauth.error' as const,
    ts: TS,
    flow_id: 'f1',
    provider: 'anthropic',
    code: 'login_rejected',
    message: 'The provider rejected the login attempt.',
  },
};

const SCHEMAS = {
  'oauth.auth_url': OAuthAuthUrlEventSchema,
  'oauth.progress': OAuthProgressEventSchema,
  'oauth.awaiting_code': OAuthAwaitingCodeEventSchema,
  'oauth.complete': OAuthCompleteEventSchema,
  'oauth.error': OAuthErrorEventSchema,
} as const;

const OAUTH_TYPES = [
  'oauth.auth_url',
  'oauth.progress',
  'oauth.awaiting_code',
  'oauth.complete',
  'oauth.error',
] as const;

describe('@swt-labs/shared — oauth.* SSE event variants (Plan 04-01)', () => {
  describe('per-variant parse / reject', () => {
    for (const type of OAUTH_TYPES) {
      it(`${type}: parses a valid representative payload`, () => {
        expect(SCHEMAS[type].safeParse(VALID[type]).success).toBe(true);
      });

      it(`${type}: rejects a payload missing flow_id`, () => {
        const { flow_id: _omit, ...missing } = VALID[type];
        void _omit;
        expect(SCHEMAS[type].safeParse(missing).success).toBe(false);
      });
    }

    it('oauth.error parses a full {type, ts, flow_id, provider, code, message} payload', () => {
      expect(OAuthErrorEventSchema.safeParse(VALID['oauth.error']).success).toBe(true);
    });

    it('oauth.complete parses a {type, ts, flow_id, provider} payload', () => {
      expect(OAuthCompleteEventSchema.safeParse(VALID['oauth.complete']).success).toBe(true);
    });
  });

  describe('discriminated-union membership (SnapshotEventSchema)', () => {
    for (const type of OAUTH_TYPES) {
      it(`SnapshotEventSchema.parse succeeds for an ${type} payload`, () => {
        expect(SnapshotEventSchema.safeParse(VALID[type]).success).toBe(true);
      });
    }
  });

  describe('SNAPSHOT_EVENT_TYPES membership', () => {
    for (const type of OAUTH_TYPES) {
      it(`SNAPSHOT_EVENT_TYPES includes '${type}'`, () => {
        expect(SNAPSHOT_EVENT_TYPES).toContain(type);
      });
    }
  });

  describe('no-secret-key structural walk — every oauth.* event schema', () => {
    for (const type of OAUTH_TYPES) {
      it(`${type}: no key matches the secret pattern at any nesting level`, () => {
        const keys = collectKeys(SCHEMAS[type]);
        // Sanity: the walk actually descended into the schema's shape.
        expect(keys).toContain('flow_id');
        expect(keys).toContain('provider');
        const offenders = keys.filter((k) => SECRET_KEY_PATTERN.test(k));
        expect(offenders).toEqual([]);
      });
    }

    it('the walk DOES catch a secret-shaped key when one is present (guard is real)', () => {
      // A negative control: prove SECRET_KEY_PATTERN + collectKeys would
      // actually flag a token leak — so the green assertions above are
      // meaningful.
      const leaky = z.object({ flow_id: z.string(), access: z.string() });
      const keys = collectKeys(leaky);
      expect(keys.filter((k) => SECRET_KEY_PATTERN.test(k))).toEqual(['access']);
    });
  });
});
