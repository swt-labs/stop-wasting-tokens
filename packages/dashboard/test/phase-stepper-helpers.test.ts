/**
 * Plan 04-03 T2 — exported helper test for `<PhaseStepper>` per-plan rendering.
 * See `project-state-panel.test.ts` for the rationale on why full DOM render
 * tests are deferred to plan 04-05.
 */

import { describe, expect, it } from 'vitest';

import { PhaseStepper, planStatusIcon } from '../src/client/components/PhaseStepper.jsx';

describe('planStatusIcon', () => {
  it('maps each plan status to its glyph', () => {
    expect(planStatusIcon('complete')).toBe('✓');
    expect(planStatusIcon('in_progress')).toBe('◆');
    expect(planStatusIcon('failed')).toBe('✗');
    expect(planStatusIcon('pending')).toBe('○');
  });

  it('returns a neutral dot for undefined status', () => {
    expect(planStatusIcon(undefined)).toBe('·');
  });
});

describe('<PhaseStepper>', () => {
  it('exports a Solid component function', () => {
    expect(typeof PhaseStepper).toBe('function');
  });
});
