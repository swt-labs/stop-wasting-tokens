import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveSeverityCounts, readUat, writeUat } from '../../src/qa/uat.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-uat-severity-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deriveSeverityCounts', () => {
  it('counts each severity bucket', () => {
    const out = deriveSeverityCounts([
      { id: 'I1', severity: 'critical', summary: 'a', details: '' },
      { id: 'I2', severity: 'major', summary: 'b', details: '' },
      { id: 'I3', severity: 'major', summary: 'c', details: '' },
      { id: 'I4', severity: 'minor', summary: 'd', details: '' },
    ]);
    expect(out).toEqual({ critical: 1, major: 2, minor: 1, cosmetic: 0 });
  });
});

describe('writeUat with severity_counts', () => {
  it('renders a Severity Mix line and round-trips the counts', async () => {
    await writeUat({
      phaseDir: dir,
      doc: {
        phase: '01',
        plan_count: 1,
        status: 'failed',
        started: '2026-05-06',
        completed: '2026-05-06',
        total_tests: 1,
        passed: 0,
        skipped: 0,
        issues: 2,
        severity_counts: { critical: 1, major: 1, minor: 0, cosmetic: 0 },
        tests: [],
        issue_records: [
          { id: 'I1', severity: 'critical', summary: 'critical issue', details: '' },
          { id: 'I2', severity: 'major', summary: 'major issue', details: '' },
        ],
        body: '',
      },
    });
    const raw = await readFile(join(dir, '01-UAT.md'), 'utf8');
    expect(raw).toContain('Severity Mix: 1 critical, 1 major');
    expect(raw).toContain('severity_counts:');

    const round = await readUat(dir, '01');
    expect(round.issues).toBe(2);
  });
});
