import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const ROADMAP = join(REPO_ROOT, 'docs', 'roadmap', 'v1.5.md');
const TRADEOFFS = join(
  REPO_ROOT,
  '.vbw-planning',
  'research',
  'ui-dashboard-tradeoffs.md',
);

describe('docs/roadmap/v1.5.md', () => {
  it('exists', () => {
    expect(existsSync(ROADMAP)).toBe(true);
  });

  it('lists 8 planned features', () => {
    const content = readFileSync(ROADMAP, 'utf8');
    for (const f of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']) {
      expect(content, `missing feature: ${f}`).toContain(`### ${f}`);
    }
  });

  it('references the load-bearing core abstractions', () => {
    const content = readFileSync(ROADMAP, 'utf8');
    expect(content).toContain('AgentSpawner');
    expect(content).toContain('HookHost');
  });

  it('includes complexity ratings (S/M/L/XL) per feature', () => {
    const content = readFileSync(ROADMAP, 'utf8');
    expect(content).toMatch(/Complexity\.\s*(S|M|L|XL|S–M|M–L|S-M)/);
  });

  it('declares the compatibility commitment + v2.0 placeholder', () => {
    const content = readFileSync(ROADMAP, 'utf8');
    expect(content).toContain('Compatibility commitment');
    expect(content).toContain('v2.0');
  });

  it('cross-references the UI dashboard tradeoffs doc', () => {
    const content = readFileSync(ROADMAP, 'utf8');
    expect(content).toContain('ui-dashboard-tradeoffs.md');
  });
});

describe('UI/dashboard design notes', () => {
  it('exists', () => {
    expect(existsSync(TRADEOFFS)).toBe(true);
  });

  it('covers all 3 options (Ink TUI, web, hybrid)', () => {
    const content = readFileSync(TRADEOFFS, 'utf8');
    expect(content).toMatch(/Option A.*Ink TUI/i);
    expect(content).toMatch(/Option B.*Web/i);
    expect(content).toMatch(/Option C.*Hybrid/i);
  });

  it('captures a recommendation', () => {
    const content = readFileSync(TRADEOFFS, 'utf8');
    expect(content).toMatch(/## Recommendation/i);
    expect(content).toMatch(/Option A.*Ink TUI/);
  });

  it('lists decision criteria for the v1.5 milestone', () => {
    const content = readFileSync(TRADEOFFS, 'utf8');
    expect(content).toMatch(/Decision criteria/i);
  });
});
