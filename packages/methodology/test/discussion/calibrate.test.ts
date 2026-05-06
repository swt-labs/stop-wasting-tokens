import { describe, expect, it } from 'vitest';

import { inferCalibration } from '../../src/discussion/calibrate.js';

describe('inferCalibration', () => {
  it('defaults to builder when no signals are provided', () => {
    expect(inferCalibration()).toBe('builder');
  });

  it('returns builder for "minimal" / "ship" wording', () => {
    expect(inferCalibration({ description: 'just a minimal CLI to ship today' })).toBe('builder');
  });

  it('returns architect for "deep dive" / enterprise wording', () => {
    expect(
      inferCalibration({
        description: 'I want to deep dive on the enterprise tradeoffs and explore options',
      }),
    ).toBe('architect');
  });

  it('honors a forced override', () => {
    expect(inferCalibration({ description: 'just minimal', forced: 'architect' })).toBe('architect');
  });

  it('long technical descriptions skew architect', () => {
    const longDesc = 'a '.repeat(150) + 'distributed system with multiple services, async messaging, and observability';
    expect(inferCalibration({ description: longDesc })).toBe('architect');
  });
});
