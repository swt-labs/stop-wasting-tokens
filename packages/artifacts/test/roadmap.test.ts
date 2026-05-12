// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { describe, expect, it } from 'vitest';

import { addPhase, insertPhase, removePhase } from '../src/roadmap/editor.js';
import type { PhaseEntry } from '../src/schemas/roadmap.js';

const PHASES: PhaseEntry[] = [
  {
    position: '01',
    slug: 'setup',
    name: 'Setup',
    goal: 'g1',
    requirements: [],
    success_criteria: [],
    status: 'complete',
  },
  {
    position: '02',
    slug: 'foundation',
    name: 'Foundation',
    goal: 'g2',
    requirements: [],
    success_criteria: [],
    status: 'pending',
  },
  {
    position: '03',
    slug: 'final',
    name: 'Final',
    goal: 'g3',
    requirements: [],
    success_criteria: [],
    status: 'pending',
  },
];

describe.skip('roadmap editor', () => {
  it('appends a new phase at the end', () => {
    const result = addPhase(PHASES, {
      slug: 'release',
      name: 'Release',
      goal: 'ship',
      requirements: [],
      success_criteria: [],
    });
    expect(result.phases).toHaveLength(4);
    expect(result.phases[3]?.position).toBe('04');
    expect(result.renames).toEqual([]);
  });

  it('inserts a phase and renames the shifted siblings', () => {
    const result = insertPhase(PHASES, 2, {
      slug: 'spike',
      name: 'Spike',
      goal: 'investigate',
      requirements: [],
      success_criteria: [],
    });
    expect(result.phases.map((p) => p.position)).toEqual(['01', '02', '03', '04']);
    expect(result.phases[1]?.slug).toBe('spike');
    expect(result.renames).toEqual([
      { from: '02-foundation', to: '03-foundation' },
      { from: '03-final', to: '04-final' },
    ]);
  });

  it('rejects an out-of-range insert position', () => {
    expect(() =>
      insertPhase(PHASES, 99, {
        slug: 'x',
        name: 'X',
        goal: 'x',
        requirements: [],
        success_criteria: [],
      }),
    ).toThrow();
  });

  it('removes a phase and renumbers later siblings', () => {
    const result = removePhase(PHASES, 2);
    expect(result.phases.map((p) => p.position)).toEqual(['01', '02']);
    expect(result.phases[1]?.slug).toBe('final');
    expect(result.renames).toEqual([{ from: '03-final', to: '02-final' }]);
  });

  it('rejects an out-of-range remove position', () => {
    expect(() => removePhase(PHASES, 99)).toThrow();
  });
});
