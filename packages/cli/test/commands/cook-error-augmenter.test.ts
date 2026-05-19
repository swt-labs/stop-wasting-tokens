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
 *
 * Phase 02 (milestone 19) — the augmenter now branches on
 * `AugmentSpawnErrorContext.authMode` between an api_key story (Console
 * quota; no allowlist text) and an oauth story (Max-plan routing;
 * allowlist as secondary cause). The no-context call signature is
 * preserved byte-identical to today's behaviour (AC-12).
 */

import { describe, expect, it } from 'vitest';

import { augmentSpawnError } from '../../src/commands/cook.js';

// Shared fixture — a real-shaped Pi turn_end error body carrying the
// canonical `request_id` we assert on for AC-10 + AC-11's "echoes
// request_id on its own labelled line" requirement.
const RAW_ERROR =
  'Pi turn_end stopReason=error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011Cb6N5ZgLXhnrWzuueo9Z5"}';

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

  describe('out of extra usage — api_key context (AC-10)', () => {
    it('leads with the canonical headline + URL, echoes request_id, omits OAuth-only text', () => {
      const out = augmentSpawnError(RAW_ERROR, { authMode: 'api_key', provider: 'anthropic' });

      // First line is exactly the canonical headline — locked verbatim
      // (Decision #12). Hard `.toBe` on split[0] so wording drift fails.
      expect(out.split('\n')[0]).toBe(
        'Anthropic says: Add more at claude.ai/settings/usage and keep going.',
      );

      // Contains the top-up URL.
      expect(out).toContain('https://claude.ai/settings/usage');

      // Echoes request_id on its own labelled line.
      expect(out).toContain('request_id: req_011Cb6N5ZgLXhnrWzuueo9Z5');

      // Raw response stays verbatim as the receipt.
      expect(out).toContain(RAW_ERROR);

      // Negative assertions — api_key has no OAuth routing, so the
      // augmenter MUST NOT surface the allowlist / Provider menu /
      // ANTHROPIC_API_KEY workarounds (AC-10 + Decision #14).
      expect(out).not.toContain('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      expect(out).not.toContain('Provider menu');
      expect(out).not.toContain('ANTHROPIC_API_KEY');
      expect(out.toLowerCase()).not.toContain('allowlist');
    });
  });

  describe('out of extra usage — oauth context (AC-11)', () => {
    it('leads with the canonical headline + URL, surfaces allowlist as secondary cause with both workarounds', () => {
      const out = augmentSpawnError(RAW_ERROR, { authMode: 'oauth', provider: 'anthropic' });

      // First line is exactly the canonical headline.
      expect(out.split('\n')[0]).toBe(
        'Anthropic says: Add more at claude.ai/settings/usage and keep going.',
      );

      // Contains the top-up URL.
      expect(out).toContain('claude.ai/settings/usage');

      // URL must appear ABOVE the allowlist text — AC-11's "Contains
      // claude.ai/settings/usage above any allowlist text".
      const urlIdx = out.indexOf('claude.ai/settings/usage');
      const allowlistIdx = out.indexOf('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      expect(urlIdx).toBeGreaterThanOrEqual(0);
      expect(allowlistIdx).toBeGreaterThan(urlIdx);

      // Allowlist hypothesis preserved as secondary cause.
      expect(out).toContain('9d1c250a-e61b-44d9-88ed-5944d1962f5e');

      // Both workarounds appear below the top-up advice.
      expect(out).toContain('Provider menu');
      expect(out).toContain('ANTHROPIC_API_KEY');

      // Echoes request_id on its own labelled line.
      expect(out).toContain('request_id: req_011Cb6N5ZgLXhnrWzuueo9Z5');

      // Raw response stays verbatim.
      expect(out).toContain(RAW_ERROR);
    });

    it('match is case-insensitive (defends against Anthropic wording-case drift)', () => {
      const lowered = RAW_ERROR.toLowerCase();
      const upper = RAW_ERROR.toUpperCase();
      const mixed = RAW_ERROR.replace('out of extra', 'Out Of Extra');
      const ctx = { authMode: 'oauth' as const, provider: 'anthropic' };
      expect(augmentSpawnError(lowered, ctx)).toContain('Anthropic says: Add more at');
      expect(augmentSpawnError(upper, ctx)).toContain('Anthropic says: Add more at');
      expect(augmentSpawnError(mixed, ctx)).toContain('Anthropic says: Add more at');
    });

    it('augmented output is multi-line and human-readable (newlines preserved)', () => {
      const out = augmentSpawnError(RAW_ERROR, { authMode: 'oauth', provider: 'anthropic' });
      // The dashboard's init-error CSS uses `white-space: pre-line` so
      // newlines render as visual line breaks. Assert the structure.
      expect(out.split('\n').length).toBeGreaterThan(5);
    });
  });

  describe('out of extra usage — no context (backwards-compat, AC-12)', () => {
    // The canonical pre-Phase-02 output. Captured verbatim from the
    // cook.ts no-context branch. Used as a literal `.toBe(...)` so PRs
    // review every wording change and a snapshot-update accident can't
    // silently regress the contract.
    const EXPECTED_LEGACY_OUTPUT =
      `Anthropic returned "out of extra usage" — your OAuth token authenticated successfully,\n` +
      `but the request was routed to Anthropic's third-party OAuth billing pool (empty by default)\n` +
      `instead of your Max plan's interactive quota. SWT/Pi sends the correct Claude Code\n` +
      `identification headers; the bottleneck is Anthropic's per-client_id allowlist.\n` +
      `\n` +
      `Workarounds:\n` +
      `  • Add an Anthropic API key via the dashboard's Provider menu (works today,\n` +
      `    bills your Console account separately from Max).\n` +
      `  • Or set ANTHROPIC_API_KEY in your shell env.\n` +
      `\n` +
      `Long-term: Anthropic must allowlist Pi's OAuth client_id\n` +
      `(\`9d1c250a-e61b-44d9-88ed-5944d1962f5e\`) for Max-plan routing.\n` +
      `\n` +
      `Raw Anthropic response: ${RAW_ERROR}`;

    it('returns byte-identical pre-Phase-02 output when context is omitted', () => {
      expect(augmentSpawnError(RAW_ERROR)).toBe(EXPECTED_LEGACY_OUTPUT);
    });
  });
});
