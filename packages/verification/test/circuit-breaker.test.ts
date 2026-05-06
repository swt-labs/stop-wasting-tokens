import { describe, expect, it } from 'vitest';

import { CompactionCircuitBreaker } from '../src/circuit-breaker.js';

describe('CompactionCircuitBreaker', () => {
  it('trips after 3 consecutive failures by default', () => {
    const cb = new CompactionCircuitBreaker();
    expect(cb.recordFailure()).toBe(false);
    expect(cb.recordFailure()).toBe(false);
    expect(cb.recordFailure()).toBe(true);
    expect(cb.isTripped()).toBe(true);
    expect(cb.currentFailures).toBe(3);
  });

  it('resets on success', () => {
    const cb = new CompactionCircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.isTripped()).toBe(false);
    expect(cb.currentFailures).toBe(0);
  });

  it('honours a custom threshold', () => {
    const cb = new CompactionCircuitBreaker({ threshold: 2 });
    cb.recordFailure();
    expect(cb.isTripped()).toBe(false);
    cb.recordFailure();
    expect(cb.isTripped()).toBe(true);
  });

  it('rejects a sub-1 threshold', () => {
    expect(() => new CompactionCircuitBreaker({ threshold: 0 })).toThrow();
  });
});
