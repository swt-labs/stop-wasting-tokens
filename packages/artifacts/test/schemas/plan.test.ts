import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PlanFrontmatterSchema,
  readPlanFrontmatter,
  writePlanFrontmatter,
  type PlanFrontmatter,
} from '../../src/schemas/plan.js';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures');

describe('PlanFrontmatterSchema', () => {
  it('parses string-only must_haves', () => {
    const fm = PlanFrontmatterSchema.parse({
      phase: '01',
      plan: '01',
      title: 'simple',
      wave: 1,
      depends_on: [],
      must_haves: ['ship the thing'],
    });
    expect(fm.must_haves).toEqual(['ship the thing']);
  });

  it('parses structured must_have blocks via the union', () => {
    const fm = PlanFrontmatterSchema.parse({
      phase: '01',
      plan: '02',
      title: 'structured',
      wave: 1,
      depends_on: [],
      must_haves: [
        { truths: ['truth1'], artifacts: ['artifact.ts'], key_links: ['link.md'] },
        'still ok as string',
      ],
    });
    expect(fm.must_haves).toHaveLength(2);
    expect(typeof fm.must_haves[0]).toBe('object');
    expect(typeof fm.must_haves[1]).toBe('string');
  });

  it('rejects malformed plan IDs', () => {
    expect(() =>
      PlanFrontmatterSchema.parse({
        phase: '01',
        plan: 'whoops',
        title: 'nope',
        wave: 1,
        depends_on: [],
        must_haves: ['x'],
      }),
    ).toThrow();
  });

  it('round-trips a structured plan via writePlanFrontmatter / readPlanFrontmatter', async () => {
    const raw = await readFile(join(FIXTURE_DIR, 'vbw-plan-sample.md'), 'utf8');
    const parsed = readPlanFrontmatter(raw);
    expect(parsed.frontmatter.phase).toBe('03');
    expect(parsed.frontmatter.plan).toBe('02');
    expect(parsed.frontmatter.must_haves).toHaveLength(2);
    expect((parsed.frontmatter.must_haves[0] as { truths: string[] }).truths).toEqual([
      'The orchestrator runs Lead before Dev',
    ]);
    expect(parsed.frontmatter.cross_phase_deps).toEqual(['02-01']);
    expect(parsed.frontmatter.effort_override).toBe('thorough');

    const rendered = writePlanFrontmatter(parsed.frontmatter, parsed.body);
    const reparsed = readPlanFrontmatter(rendered);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
  });

  it('accepts the SWT-grade 09-01-PLAN string-array shape (backwards compat)', () => {
    const fm: PlanFrontmatter = PlanFrontmatterSchema.parse({
      phase: '09',
      plan: '01',
      title: 'phase-detect TS port',
      wave: 1,
      depends_on: [],
      must_haves: [
        'TypeScript port matching VBW phase-detect.sh state machine',
        'Zod schema for the PhaseDetectResult shape',
      ],
    });
    expect(fm.must_haves).toHaveLength(2);
    expect(fm.cross_phase_deps).toEqual([]);
  });
});
