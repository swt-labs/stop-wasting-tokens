import { describe, expect, it } from 'vitest';

import { resolveUatRemediationRoundLimit } from '../../src/qa/round-cap.js';

describe('resolveUatRemediationRoundLimit', () => {
  it('returns unlimited when max is false', () => {
    const out = resolveUatRemediationRoundLimit({ maxRounds: false, currentRound: 7 });
    expect(out.maxRounds).toBe('unlimited');
    expect(out.capReached).toBe(false);
    expect(out.nextRound).toBe(8);
  });

  it('returns unlimited when max is missing/null', () => {
    expect(resolveUatRemediationRoundLimit({ maxRounds: null, currentRound: 1 }).capReached).toBe(false);
    expect(resolveUatRemediationRoundLimit({ maxRounds: undefined, currentRound: 1 }).capReached).toBe(false);
  });

  it('flags capReached when current >= max', () => {
    const at = resolveUatRemediationRoundLimit({ maxRounds: 3, currentRound: 3 });
    expect(at.capReached).toBe(true);
    expect(at.maxRounds).toBe(3);
    expect(at.nextRound).toBe(4);

    const past = resolveUatRemediationRoundLimit({ maxRounds: 3, currentRound: 5 });
    expect(past.capReached).toBe(true);
  });

  it('does not flag when current < max', () => {
    const out = resolveUatRemediationRoundLimit({ maxRounds: 5, currentRound: 2 });
    expect(out.capReached).toBe(false);
    expect(out.nextRound).toBe(3);
  });

  it('treats invalid numeric values as unlimited', () => {
    expect(
      resolveUatRemediationRoundLimit({ maxRounds: 0 as unknown as number, currentRound: 1 })
        .maxRounds,
    ).toBe('unlimited');
    expect(
      resolveUatRemediationRoundLimit({ maxRounds: -2 as unknown as number, currentRound: 1 })
        .maxRounds,
    ).toBe('unlimited');
  });
});
