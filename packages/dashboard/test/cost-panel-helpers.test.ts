/**
 * Plan 04-03 T4 — pure-helper coverage for `<CostPanel>` extensions.
 * Render-output verification is deferred to plan 04-05's e2e smoke (no Solid
 * testing-library in the workspace; see project-state-panel.test.ts for the
 * rationale).
 */

import { describe, expect, it } from 'vitest';

import {
  CostPanel,
  formatCacheHitRatio,
  formatTokenCount,
} from '../src/client/components/CostPanel.jsx';

describe('formatCacheHitRatio', () => {
  it('renders a 0..1 ratio as a 1-decimal percent', () => {
    expect(formatCacheHitRatio(0)).toBe('0.0%');
    expect(formatCacheHitRatio(0.4)).toBe('40.0%');
    expect(formatCacheHitRatio(0.4567)).toBe('45.7%');
    expect(formatCacheHitRatio(1)).toBe('100.0%');
  });

  it('renders an em-dash for undefined / NaN', () => {
    expect(formatCacheHitRatio(undefined)).toBe('—');
    expect(formatCacheHitRatio(Number.NaN)).toBe('—');
  });
});

describe('formatTokenCount', () => {
  it('renders integer counts with locale grouping', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(1234)).toBe('1,234');
    expect(formatTokenCount(1_234_567)).toBe('1,234,567');
  });

  it('renders an em-dash for undefined / NaN', () => {
    expect(formatTokenCount(undefined)).toBe('—');
    expect(formatTokenCount(Number.NaN)).toBe('—');
  });
});

describe('<CostPanel>', () => {
  it('exports a Solid component function', () => {
    expect(typeof CostPanel).toBe('function');
  });
});
