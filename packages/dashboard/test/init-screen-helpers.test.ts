/**
 * Plan 19-03-01 T02 — pure-function tests for `classifyInitLine`, the
 * render-time classifier that maps post-Phase-01 trace-sink output into
 * friendly progress labels for the live status block above the
 * Initialize button on InitScreen.
 *
 * Phase 04 will extend this file with the `selectInitialProvider` +
 * `computeProviderStatus` helpers — naming the file `init-screen-helpers`
 * (plural-friendly) anticipates that, matching brief §H line 432.
 *
 * No Solid component harness, no DOM. classifyInitLine is exported from
 * InitScreen.tsx specifically so the classifier truth table can be
 * exhaustively asserted without rendering the component.
 */

import type { ProviderAuthStatus } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  classifyInitLine,
  computeProviderStatus,
  selectInitialProvider,
} from '../src/client/components/InitScreen.js';

describe('classifyInitLine', () => {
  describe('[tool] prefix', () => {
    it('maps Read to "reading project files… (Read)"', () => {
      expect(classifyInitLine('[tool] Read')).toBe('reading project files… (Read)');
    });

    it('maps Grep to "searching project files… (Grep)"', () => {
      expect(classifyInitLine('[tool] Grep')).toBe('searching project files… (Grep)');
    });

    it('maps Glob to "listing project files… (Glob)"', () => {
      expect(classifyInitLine('[tool] Glob')).toBe('listing project files… (Glob)');
    });

    it('maps Write to "writing files… (Write)"', () => {
      expect(classifyInitLine('[tool] Write')).toBe('writing files… (Write)');
    });

    it('maps Edit to "editing files… (Edit)"', () => {
      expect(classifyInitLine('[tool] Edit')).toBe('editing files… (Edit)');
    });

    it('maps Bash to "running shell command… (Bash)"', () => {
      expect(classifyInitLine('[tool] Bash')).toBe('running shell command… (Bash)');
    });

    it('falls back to "using tool… (X)" for unknown tools', () => {
      expect(classifyInitLine('[tool] SomeUnknownTool')).toBe('using tool… (SomeUnknownTool)');
    });
  });

  describe('[llm turn N] prefix', () => {
    it('wraps short text in thinking… "..."', () => {
      expect(classifyInitLine('[llm turn 1] hello world')).toBe('thinking… "hello world"');
    });

    it('preserves text shorter than 80 chars without truncation', () => {
      expect(classifyInitLine('[llm turn 5] short')).toBe('thinking… "short"');
    });

    it('truncates text longer than 80 chars with an ellipsis', () => {
      // 100 characters, no spaces — guarantees slice(0, 80) cuts cleanly.
      const long = 'x'.repeat(100);
      const expected = `thinking… "${'x'.repeat(80)}…"`;
      expect(classifyInitLine(`[llm turn 42] ${long}`)).toBe(expected);
    });

    it('handles double-digit turn numbers', () => {
      expect(classifyInitLine('[llm turn 17] reasoning about next step')).toBe(
        'thinking… "reasoning about next step"',
      );
    });
  });

  describe('CLI contract prefixes', () => {
    it('maps "✓ Initialized .swt-planning/" to "wrote .swt-planning/"', () => {
      expect(classifyInitLine('✓ Initialized .swt-planning/')).toBe('wrote .swt-planning/');
    });

    it('maps "→ Spawning Lead" to "spawning Lead (commands/init.md)…"', () => {
      expect(classifyInitLine('→ Spawning Lead (commands/init.md)…')).toBe(
        'spawning Lead (commands/init.md)…',
      );
    });

    it('maps "✓ Lead bootstrap complete" to "bootstrap complete, finalizing…"', () => {
      expect(classifyInitLine('✓ Lead bootstrap complete')).toBe('bootstrap complete, finalizing…');
    });
  });

  describe('falsy / undefined / empty input', () => {
    it('returns "detecting stack…" for undefined', () => {
      expect(classifyInitLine(undefined)).toBe('detecting stack…');
    });

    it('returns "detecting stack…" for empty string (falsy check catches it)', () => {
      expect(classifyInitLine('')).toBe('detecting stack…');
    });
  });

  describe('unknown lines (defensive fallback)', () => {
    it('renders an unrecognized line verbatim', () => {
      expect(classifyInitLine('some unknown line')).toBe('some unknown line');
    });

    it('renders a line that looks like a tool but lacks the space delimiter', () => {
      // Doesn't match '[tool] ' (with trailing space) — falls through to raw.
      expect(classifyInitLine('[tool]Read')).toBe('[tool]Read');
    });
  });
});

/**
 * Plan 19-04-01 T01 — pure-function tests for the two provider-selector
 * helpers exported from InitScreen.tsx. Each helper is a pure mapping from
 * the actual `ProviderAuthStatus` Zod schema (configured + mode + source +
 * label) to the dropdown's default selection / status-indicator color.
 *
 * Adapted from the brief's assumed `status: 'authed'|'missing'|'expired'`
 * field per Phase 04 research P1 (no such field exists) — the actual rule
 * is `(configured && mode !== null) → 'green'`, anything else → 'red',
 * null credential → 'empty'.
 */
const mkStatus = (overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus => ({
  provider: 'anthropic',
  configured: true,
  mode: 'oauth',
  source: 'keychain',
  label: 'Anthropic',
  ...overrides,
});

describe('selectInitialProvider', () => {
  it('returns null on empty list', () => {
    expect(selectInitialProvider([], null)).toBe(null);
    expect(selectInitialProvider([], 'anthropic')).toBe(null);
  });

  it('matches selected_provider id when present', () => {
    const a = mkStatus({ provider: 'anthropic' });
    const o = mkStatus({ provider: 'openai', configured: false, mode: null });
    const result = selectInitialProvider([o, a], 'anthropic');
    expect(result).toBe(a);
  });

  it('falls back to first authed credential when selected_provider unknown', () => {
    const unauthed = mkStatus({ provider: 'openai', configured: false, mode: null });
    const authed = mkStatus({ provider: 'anthropic', configured: true, mode: 'api_key' });
    const result = selectInitialProvider([unauthed, authed], 'gemini');
    expect(result).toBe(authed);
  });

  it('falls back to first authed credential when selected_provider is null', () => {
    const unauthed = mkStatus({ provider: 'openai', configured: false, mode: null });
    const authed = mkStatus({ provider: 'anthropic', configured: true, mode: 'oauth' });
    const result = selectInitialProvider([unauthed, authed], null);
    expect(result).toBe(authed);
  });

  it('falls back to first overall when nothing is authed', () => {
    const a = mkStatus({ provider: 'openai', configured: false, mode: null });
    const b = mkStatus({ provider: 'anthropic', configured: false, mode: null });
    const result = selectInitialProvider([a, b], null);
    expect(result).toBe(a);
  });
});

describe('computeProviderStatus', () => {
  it('returns empty for null credential', () => {
    expect(computeProviderStatus(null)).toBe('empty');
  });

  it('returns green when configured AND mode set', () => {
    expect(computeProviderStatus(mkStatus({ configured: true, mode: 'oauth' }))).toBe('green');
    expect(computeProviderStatus(mkStatus({ configured: true, mode: 'api_key' }))).toBe('green');
  });

  it('returns red when configured is false', () => {
    expect(computeProviderStatus(mkStatus({ configured: false, mode: 'api_key' }))).toBe('red');
    expect(computeProviderStatus(mkStatus({ configured: false, mode: null }))).toBe('red');
  });

  it('returns red when mode is null even if configured is true (degraded state)', () => {
    expect(computeProviderStatus(mkStatus({ configured: true, mode: null }))).toBe('red');
  });
});
