import { describe, expect, it } from 'vitest';

import {
  ALLOWED_NON_INTERACTIVE_VERBS,
  INTERACTIVE_VERBS,
  KNOWN_VERBS,
  classifyVerb,
} from '../src/server/lib/allowed-verbs.ts';

describe('ALLOWED_VERBS allowlist', () => {
  it('non-interactive allowlist matches the v1.6.6 contract exactly', () => {
    const expected = new Set(['help', 'version', 'status', 'doctor', 'detect-phase', 'update']);
    expect(new Set([...ALLOWED_NON_INTERACTIVE_VERBS])).toEqual(expected);
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
    // not runnable. Dashboard must reject them with a hint.
    const stubs = ['init', 'plan', 'execute', 'qa', 'archive', 'release'];
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
