import { describe, expect, it } from 'vitest';

import { calculateCost } from '../../src/meter/cost-aggregator.js';

describe('@swt-labs/runtime — calculateCost', () => {
  it('multiplies component-wise and divides by 1M (Anthropic sonnet, known rates)', () => {
    // Sonnet 4.5 rates per docs (illustrative): $3/M input, $15/M output,
    // $0.30/M cache read, $3.75/M cache write.
    const cost = calculateCost(
      { input: 1_000, output: 500, cacheRead: 10_000, cacheWrite: 2_000 },
      { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    );
    // = (1000*3 + 500*15 + 10000*0.3 + 2000*3.75) / 1e6
    // = (3000 + 7500 + 3000 + 7500) / 1e6 = 21000/1e6 = 0.021
    expect(cost).toBeCloseTo(0.021, 10);
  });

  it('returns 0 when all usage fields are 0', () => {
    expect(
      calculateCost(
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        { input: 100, output: 100, cacheRead: 100, cacheWrite: 100 },
      ),
    ).toBe(0);
  });

  it('returns 0 when all rates are 0 regardless of usage', () => {
    expect(
      calculateCost(
        { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ),
    ).toBe(0);
  });

  it('cache dimensions independently contribute', () => {
    const a = calculateCost(
      { input: 0, output: 0, cacheRead: 1000, cacheWrite: 0 },
      { input: 0, output: 0, cacheRead: 0.3, cacheWrite: 0 },
    );
    const b = calculateCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 1000 },
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 3.75 },
    );
    expect(a).toBeCloseTo(0.0003, 10);
    expect(b).toBeCloseTo(0.00375, 10);
  });

  it('matches the OpenAI gpt-5 pricing model (no cacheWrite)', () => {
    // gpt-5 illustrative: $2/M input, $10/M output, $0.50/M cache read.
    const cost = calculateCost(
      { input: 10_000, output: 5_000, cacheRead: 4_000, cacheWrite: 0 },
      { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 0 },
    );
    // = (10000*2 + 5000*10 + 4000*0.5) / 1e6 = (20000 + 50000 + 2000)/1e6 = 0.072
    expect(cost).toBeCloseTo(0.072, 10);
  });
});
