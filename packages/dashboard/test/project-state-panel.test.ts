/**
 * Plan 04-03 T2 — `<ProjectStatePanel>` coverage.
 *
 * The dashboard SPA has no in-tree test renderer for Solid (no testing-library
 * dep, and vitest's default esbuild transform doesn't emit Solid-compatible
 * JSX). To keep this plan's test deliverable shippable without a workspace
 * dep bump we (a) unit-test the exported `percentLabel` helper and (b) smoke-
 * test that the component module is importable and the `ProjectStatePanel`
 * export is a callable Solid component. Render-output verification is
 * deferred to plan 04-05's end-to-end smoke test.
 */

import { describe, expect, it } from 'vitest';

import {
  ProjectStatePanel,
  percentLabel,
} from '../src/client/components/ProjectStatePanel.jsx';

describe('percentLabel', () => {
  it('rounds the 0..1 percent_complete to whole percent', () => {
    expect(percentLabel({ name: 'M', phase_count: 5, phase_index: 1, percent_complete: 0.4 })).toBe(
      '40%',
    );
    expect(
      percentLabel({ name: 'M', phase_count: 5, phase_index: 1, percent_complete: 0.426 }),
    ).toBe('43%');
    expect(percentLabel({ name: 'M', phase_count: 5, phase_index: 1, percent_complete: 0 })).toBe(
      '0%',
    );
    expect(percentLabel({ name: 'M', phase_count: 5, phase_index: 1, percent_complete: 1 })).toBe(
      '100%',
    );
  });

  it('returns an empty string when percent_complete is undefined', () => {
    expect(percentLabel({ name: 'M', phase_count: 5, phase_index: 1 })).toBe('');
  });
});

describe('<ProjectStatePanel>', () => {
  it('exports a Solid component function', () => {
    expect(typeof ProjectStatePanel).toBe('function');
  });
});
