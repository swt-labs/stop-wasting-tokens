import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SummaryFrontmatterSchema,
  readSummaryFrontmatter,
  writeSummaryFrontmatter,
} from '../../src/schemas/summary.js';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures');

describe('SummaryFrontmatterSchema', () => {
  it('normalizes VBW-grade ac_results (must_have/status) to (criterion/verdict)', () => {
    const fm = SummaryFrontmatterSchema.parse({
      phase: '03',
      plan: '02',
      title: 'sample',
      status: 'complete',
      completed: '2026-05-06',
      tasks_completed: 1,
      tasks_total: 1,
      ac_results: [
        {
          id: 'AC1',
          must_have: 'lead first',
          status: 'pass',
          evidence: 'logs',
        },
      ],
    });
    expect(fm.ac_results).toEqual([
      { id: 'AC1', criterion: 'lead first', verdict: 'pass', evidence: 'logs' },
    ]);
  });

  it('normalizes SWT-style ac_results (criterion/verdict) and preserves them', () => {
    const fm = SummaryFrontmatterSchema.parse({
      phase: '03',
      plan: '02',
      title: 'sample',
      status: 'complete',
      completed: '2026-05-06',
      tasks_completed: 1,
      tasks_total: 1,
      ac_results: [
        {
          id: 'AC1',
          criterion: 'lead first',
          verdict: 'pass',
          evidence: 'logs',
        },
      ],
    });
    expect(fm.ac_results[0]?.criterion).toBe('lead first');
    expect(fm.ac_results[0]?.verdict).toBe('pass');
  });

  it('normalizes deviations (rationale -> resolution)', () => {
    const fm = SummaryFrontmatterSchema.parse({
      phase: '03',
      plan: '02',
      title: 'sample',
      status: 'complete',
      completed: '2026-05-06',
      tasks_completed: 0,
      tasks_total: 0,
      deviations: [
        {
          id: 'D1',
          type: 'scope',
          description: 'cut a feature',
          rationale: 'punt to next phase',
        },
      ],
    });
    expect(fm.deviations[0]).toEqual({
      id: 'D1',
      type: 'scope',
      description: 'cut a feature',
      resolution: 'punt to next phase',
    });
  });

  it('round-trips the VBW-grade fixture without data loss', async () => {
    const raw = await readFile(join(FIXTURE_DIR, 'vbw-summary-sample.md'), 'utf8');
    const parsed = readSummaryFrontmatter(raw);
    expect(parsed.frontmatter.ac_results).toHaveLength(2);
    expect(parsed.frontmatter.ac_results[0]?.criterion).toBe('Lead runs before Dev');
    expect(parsed.frontmatter.deviations[0]?.resolution).toBe('Out of scope for this plan');

    const rendered = writeSummaryFrontmatter(parsed.frontmatter, parsed.body);
    const reparsed = readSummaryFrontmatter(rendered);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
  });

  it('reads the existing SWT 09-08-SUMMARY shape (status/must_have hybrid)', () => {
    const fm = SummaryFrontmatterSchema.parse({
      phase: '09',
      plan: '08',
      title: 'discussion engine',
      status: 'complete',
      completed: '2026-05-06',
      tasks_completed: 9,
      tasks_total: 9,
      ac_results: [
        {
          id: 'AC1',
          must_have: 'inferCalibration heuristic',
          status: 'pass',
          evidence: 'calibrate.test.ts covers 5 cases',
        },
      ],
    });
    expect(fm.ac_results[0]?.criterion).toBe('inferCalibration heuristic');
    expect(fm.ac_results[0]?.verdict).toBe('pass');
  });
});
