import { describe, expect, it } from 'vitest';

import { RoutingError } from '../../../src/vibe/errors.js';
import {
  groupByWave,
  validateDependencyOrder,
  validateDisjointFiles,
  type PlanRecord,
} from '../../../src/vibe/orchestration/waves.js';

function plan(over: Partial<PlanRecord> & { plan: string }): PlanRecord {
  return {
    plan: over.plan,
    title: over.title ?? `Plan ${over.plan}`,
    wave: over.wave ?? 1,
    depends_on: over.depends_on ?? [],
    files_modified: over.files_modified ?? [],
  };
}

describe('groupByWave', () => {
  it('returns waves in ascending order', () => {
    const result = groupByWave([
      plan({ plan: '01', wave: 2 }),
      plan({ plan: '02', wave: 1 }),
      plan({ plan: '03', wave: 1 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.wave).toBe(1);
    expect(result[1]?.wave).toBe(2);
    expect(result[0]?.plans).toHaveLength(2);
  });

  it('handles a single wave', () => {
    const result = groupByWave([plan({ plan: '01' })]);
    expect(result).toHaveLength(1);
    expect(result[0]?.wave).toBe(1);
  });
});

describe('validateDisjointFiles', () => {
  it('passes when files do not overlap', () => {
    const wave = {
      wave: 1,
      plans: [
        plan({ plan: '01', files_modified: ['a.ts', 'b.ts'] }),
        plan({ plan: '02', files_modified: ['c.ts'] }),
      ],
    };
    expect(() => validateDisjointFiles(wave)).not.toThrow();
  });

  it('throws when same-wave plans share a file', () => {
    const wave = {
      wave: 1,
      plans: [
        plan({ plan: '01', files_modified: ['a.ts'] }),
        plan({ plan: '02', files_modified: ['a.ts'] }),
      ],
    };
    expect(() => validateDisjointFiles(wave)).toThrow(RoutingError);
  });
});

describe('validateDependencyOrder', () => {
  it('accepts dependencies in earlier waves', () => {
    expect(() =>
      validateDependencyOrder([
        plan({ plan: '01', wave: 1 }),
        plan({ plan: '02', wave: 2, depends_on: ['01'] }),
      ]),
    ).not.toThrow();
  });

  it('rejects same-wave dependencies', () => {
    expect(() =>
      validateDependencyOrder([
        plan({ plan: '01', wave: 1 }),
        plan({ plan: '02', wave: 1, depends_on: ['01'] }),
      ]),
    ).toThrow(RoutingError);
  });

  it('rejects forward dependencies', () => {
    expect(() =>
      validateDependencyOrder([
        plan({ plan: '01', wave: 1, depends_on: ['02'] }),
        plan({ plan: '02', wave: 2 }),
      ]),
    ).toThrow(RoutingError);
  });

  it('rejects unknown dependencies', () => {
    expect(() =>
      validateDependencyOrder([plan({ plan: '01', depends_on: ['99'] })]),
    ).toThrow(RoutingError);
  });
});
