/**
 * Plan 19-03-01 T02 — pure-function tests for `classifyInitLine`, the
 * render-time classifier that maps post-Phase-01 trace-sink output into
 * friendly progress labels for the live status block above the
 * Initialize button on InitScreen.
 *
 * Milestone 23 Phase 02 T02 update: the `computeProviderStatus` describe
 * block + import were removed when the InitScreen wizard's provider gate
 * was deleted (Locked Decision #10 — vendor-agnostic init). The function
 * itself is no longer exported from `InitScreen.tsx`; the wizard reads
 * NO providerAuth data. `classifyInitLine` survives as a pure export
 * because the synchronous scaffold could still surface fall-through
 * trace lines in unusual code paths; the test stays as an isolation
 * guard for the truth table.
 *
 * No Solid component harness, no DOM. classifyInitLine is exported from
 * InitScreen.tsx specifically so the classifier truth table can be
 * exhaustively asserted without rendering the component.
 */

import { describe, expect, it } from 'vitest';

import { classifyInitLine } from '../src/client/components/InitScreen.js';

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

// computeProviderStatus describe block retired in milestone 23 Phase 02 T02.
// The wizard is vendor-agnostic per Locked Decision #10 — InitScreen no
// longer imports ProviderAuthSnapshot or ProviderAuthStatus, and the
// computeProviderStatus helper is deleted from InitScreen.tsx. The
// provider-auth flow continues to work via ProviderAuthPanel in TopBar
// independently; there is no remaining call site for a provider-status
// computation INSIDE the wizard. Provider authentication is a per-
// operation concern, not a project-init concern.
