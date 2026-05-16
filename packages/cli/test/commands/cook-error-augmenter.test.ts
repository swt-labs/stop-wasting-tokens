/**
 * alpha.22 — `augmentSpawnError` coverage.
 *
 * The augmenter is the single source of truth for SWT-specific actionable
 * context attached to known upstream-LLM-failure patterns. Currently
 * covers the Anthropic Max-plan OAuth "out of extra usage" case (third-
 * party OAuth requests routed to Anthropic's separate `extra_usage`
 * billing pool until Anthropic adds Pi's OAuth client_id to the Max-plan-
 * routing allowlist). Wired into both `cook.ts` and `init.ts` so the
 * dashboard surfaces the same augmented message regardless of which
 * spawn path failed.
 */

import { describe, expect, it } from 'vitest';

import { augmentSpawnError } from '../../src/commands/cook.js';

describe('@swt-labs/cli — augmentSpawnError (alpha.22)', () => {
  it('returns empty string for undefined input', () => {
    expect(augmentSpawnError(undefined)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(augmentSpawnError('')).toBe('');
  });

  it('passes unrecognised errors through unchanged', () => {
    const raw = 'Pi turn_end stopReason=error: 503 Service Unavailable';
    expect(augmentSpawnError(raw)).toBe(raw);
  });

  describe('Anthropic Max-plan OAuth third-party billing pool', () => {
    const RAW_ERROR =
      'Pi turn_end stopReason=error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011Cb6N5ZgLXhnrWzuueo9Z5"}';

    it('prepends actionable SWT context when error contains "out of extra usage"', () => {
      const out = augmentSpawnError(RAW_ERROR);
      // Lead with the headline so a glance-read tells the user what's
      // happening.
      expect(out).toContain('Anthropic returned "out of extra usage"');
      // Explain WHY (third-party billing pool) — the user otherwise sees
      // a confusing message against a healthy Max subscription.
      expect(out).toContain('third-party OAuth billing pool');
      expect(out).toContain('Max plan');
      // Tell them what to do RIGHT NOW.
      expect(out).toContain('Provider menu');
      expect(out).toContain('ANTHROPIC_API_KEY');
      // Pi's client_id for support-thread evidence — copy-pasteable.
      expect(out).toContain('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      // Raw error stays verbatim so we don't hide the receipt.
      expect(out).toContain(RAW_ERROR);
    });

    it('match is case-insensitive (defends against Anthropic wording-case drift)', () => {
      const lowered = RAW_ERROR.toLowerCase();
      const upper = RAW_ERROR.toUpperCase();
      const mixed = RAW_ERROR.replace('out of extra', 'Out Of Extra');
      expect(augmentSpawnError(lowered)).toContain('Anthropic returned');
      expect(augmentSpawnError(upper)).toContain('Anthropic returned');
      expect(augmentSpawnError(mixed)).toContain('Anthropic returned');
    });

    it('augmented output is multi-line and human-readable (newlines preserved)', () => {
      const out = augmentSpawnError(RAW_ERROR);
      // The dashboard's init-error CSS uses `white-space: pre-line` so
      // newlines render as visual line breaks. Assert the structure.
      expect(out.split('\n').length).toBeGreaterThan(5);
      // Workarounds bullet list — explicit lead-in so the user spots the
      // actionable section even on a long error card.
      expect(out).toContain('Workarounds:');
    });
  });
});
