import { describe, expect, it } from 'vitest';

import {
  ALLOWED_NON_INTERACTIVE_VERBS,
  INTERACTIVE_VERBS,
  KNOWN_VERBS,
  QUICK_VERB_TIMEOUT_MS_OVERRIDE,
  classifyVerb,
} from '../src/server/lib/allowed-verbs.ts';

describe('ALLOWED_VERBS allowlist', () => {
  it('non-interactive allowlist covers v1.6.6 + plan 04-02 T5 + plan 15-01-01 T4 + plan 15-02-01 T4 verbs', () => {
    const expected = new Set([
      // v1.6.6 baseline
      'help',
      'version',
      'status',
      'doctor',
      'detect-phase',
      'update',
      // Plan 04-02 T5 (REQ-17) quick action verbs
      'fix',
      'debug',
      'qa',
      'verify',
      'research',
      'map',
      // Plan 15-01-01 T4 — newly-graduated cook aliases. plan/execute/audit
      // are non-interactive in their cook routing; discuss/assumptions/
      // archive/phase stay off the allowlist (they hit askUser checkpoints).
      'plan',
      'execute',
      'audit',
      // Plan 15-02-01 T4 — `todo` graduated from STUB to a real
      // line-by-line file I/O verb (append to STATE.md + optional
      // sidecar). No Pi spawn, no askUser, no stdin prompts.
      'todo',
    ]);
    expect(new Set([...ALLOWED_NON_INTERACTIVE_VERBS])).toEqual(expected);
  });

  it('cook is intentionally excluded — uses POST /api/cook/start instead', () => {
    expect(ALLOWED_NON_INTERACTIVE_VERBS.has('cook')).toBe(false);
    expect(INTERACTIVE_VERBS.has('cook')).toBe(false);
  });

  it('QUICK_VERB_TIMEOUT_MS_OVERRIDE provides stretched budgets for quick verbs', () => {
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['fix']).toBe(60_000);
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['debug']).toBe(60_000);
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['qa']).toBe(60_000);
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['research']).toBe(60_000);
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['map']).toBe(60_000);
    expect(QUICK_VERB_TIMEOUT_MS_OVERRIDE['verify']).toBe(90_000);
  });

  it('interactive set matches the v1.6.6 contract exactly', () => {
    const expected = new Set(['vibe', 'watch', 'dashboard']);
    expect(new Set([...INTERACTIVE_VERBS])).toEqual(expected);
  });

  it('non-interactive and interactive sets are disjoint', () => {
    for (const verb of ALLOWED_NON_INTERACTIVE_VERBS) {
      expect(INTERACTIVE_VERBS.has(verb)).toBe(false);
    }
  });

  it('KNOWN_VERBS = union of non-interactive and interactive', () => {
    const expected = new Set([...ALLOWED_NON_INTERACTIVE_VERBS, ...INTERACTIVE_VERBS]);
    expect(new Set([...KNOWN_VERBS])).toEqual(expected);
  });
});

describe('classifyVerb', () => {
  it('classifies allowlist verbs as literal', () => {
    for (const verb of ALLOWED_NON_INTERACTIVE_VERBS) {
      expect(classifyVerb(verb)).toEqual({ decision: 'literal', verb });
    }
  });

  it('classifies interactive verbs as rejected_interactive', () => {
    for (const verb of INTERACTIVE_VERBS) {
      expect(classifyVerb(verb)).toEqual({ decision: 'rejected_interactive', verb });
    }
  });

  it('classifies stub verbs as rejected_unknown', () => {
    // Per packages/cli/src/commands/stubs.ts — these are roadmap placeholders,
    // not runnable. Dashboard must reject them with a hint. (`qa` was a stub
    // pre-04-02 but plan 04-02 T5 promoted it to the quick-action allowlist;
    // `plan` / `execute` were stubs pre-15-01-01 but plan 15-01-01 T4
    // promoted them to the cook-alias allowlist.) `archive` was promoted
    // to a thin alias in plan 15-01-01 T3 but stays OFF the dashboard
    // allowlist (interactive — hits askUser checkpoints inside cook), so
    // it still classifies as rejected_unknown today.
    const stubs = ['release', 'resume', 'pause', 'archive'];
    for (const verb of stubs) {
      expect(classifyVerb(verb)).toEqual({ decision: 'rejected_unknown', verb });
    }
  });

  it('classifies natural-language input as rejected_unknown', () => {
    const fakeInputs = ["i'd", 'create', 'make', 'please', 'show'];
    for (const verb of fakeInputs) {
      expect(classifyVerb(verb)).toEqual({ decision: 'rejected_unknown', verb });
    }
  });

  it('lowercases input before lookup', () => {
    expect(classifyVerb('STATUS')).toEqual({ decision: 'literal', verb: 'status' });
    expect(classifyVerb('Vibe')).toEqual({ decision: 'rejected_interactive', verb: 'vibe' });
  });
});
