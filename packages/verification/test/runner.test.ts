import { describe, expect, it } from 'vitest';

import { runQa } from '../src/runner.js';

const PASS_CHECK = {
  id: 'AC1',
  must_have: 'foo',
  status: 'pass' as const,
  evidence: 'all green',
};

describe('runQa', () => {
  it('returns pass when every check passes with evidence at standard tier', () => {
    const out = runQa({
      tier: 'standard',
      phase: '01',
      plans_verified: ['01'],
      checks: [PASS_CHECK],
    });
    expect(out.result).toBe('pass');
    expect(out.downgrade_reason).toBeUndefined();
    expect(out.required_role).toBe('qa');
  });

  it('downgrades to partial when an evidence string is empty at standard tier', () => {
    const out = runQa({
      tier: 'standard',
      phase: '01',
      plans_verified: ['01'],
      checks: [{ ...PASS_CHECK, evidence: '' }],
    });
    expect(out.result).toBe('partial');
    expect(out.downgrade_reason).toContain('evidence');
  });

  it('returns fail when any check fails', () => {
    const out = runQa({
      tier: 'standard',
      phase: '01',
      plans_verified: ['01'],
      checks: [PASS_CHECK, { ...PASS_CHECK, id: 'AC2', status: 'fail', evidence: 'bug' }],
    });
    expect(out.result).toBe('fail');
  });

  it('downgrades to partial at deep tier when traceability is broken', () => {
    const out = runQa({
      tier: 'deep',
      phase: '01',
      plans_verified: ['01'],
      checks: [PASS_CHECK],
      traceability_ok: false,
    });
    expect(out.result).toBe('partial');
    expect(out.downgrade_reason).toContain('traceability');
  });

  it('does not require evidence at quick tier', () => {
    const out = runQa({
      tier: 'quick',
      phase: '01',
      plans_verified: ['01'],
      checks: [{ ...PASS_CHECK, evidence: '' }],
    });
    expect(out.result).toBe('pass');
  });
});
