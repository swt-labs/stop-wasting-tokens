import { describe, expect, it } from 'vitest';

import { generateGrayAreas } from '../../src/discussion/gray-areas.js';

describe('generateGrayAreas', () => {
  it('bootstrap mode for builder yields the core 5 questions', () => {
    const out = generateGrayAreas({
      mode: 'bootstrap',
      context: { mode: 'bootstrap' },
      calibration: 'builder',
    });
    expect(out.map((g) => g.id)).toEqual([
      'project_name',
      'description',
      'core_value',
      'license',
      'target_users',
    ]);
    expect(out.find((g) => g.id === 'license')?.recommendation).toBe('mit');
  });

  it('bootstrap mode for architect adds tech stack + deployment', () => {
    const out = generateGrayAreas({
      mode: 'bootstrap',
      context: { mode: 'bootstrap' },
      calibration: 'architect',
    });
    const ids = out.map((g) => g.id);
    expect(ids).toContain('tech_stack');
    expect(ids).toContain('deployment');
  });

  it('scope mode includes phase_count + deferred_ideas', () => {
    const out = generateGrayAreas({
      mode: 'scope',
      context: { mode: 'scope' },
      calibration: 'builder',
    });
    const ids = out.map((g) => g.id);
    expect(ids).toContain('phase_count');
    expect(ids).toContain('deferred_ideas');
  });

  it('phase mode for builder asks goal_clarity + success_criteria', () => {
    const out = generateGrayAreas({
      mode: 'phase',
      context: { mode: 'phase' },
      calibration: 'builder',
    });
    expect(out.map((g) => g.id)).toEqual(['goal_clarity', 'success_criteria']);
  });

  it('phase mode for architect adds risk surface', () => {
    const out = generateGrayAreas({
      mode: 'phase',
      context: { mode: 'phase' },
      calibration: 'architect',
    });
    expect(out.map((g) => g.id)).toContain('risk');
  });
});
