import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readUat, writeUat } from '../../src/qa/uat.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-uat-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('uat artifact', () => {
  it('round-trips a complete UAT with tests + issues', async () => {
    const path = await writeUat({
      phaseDir: dir,
      doc: {
        phase: '01',
        plan_count: 1,
        status: 'complete',
        started: '2026-05-06',
        completed: '2026-05-06',
        total_tests: 2,
        passed: 2,
        skipped: 0,
        issues: 0,
        tests: [
          { id: 'T1', description: 'Login works', status: 'pass', notes: '' },
          { id: 'T2', description: 'Logout works', status: 'pass', notes: '' },
        ],
        issue_records: [],
        body: '',
      },
    });

    expect(path.endsWith('01-UAT.md')).toBe(true);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('plan_count: 1');
    expect(raw).toContain('passed: 2');
    expect(raw).toContain('| T1 | Login works | PASS |');

    const round = await readUat(dir, '01');
    expect(round.phase).toBe('01');
    expect(round.status).toBe('complete');
    expect(round.passed).toBe(2);
  });

  it('writes to a custom path when provided (round-dir layout)', async () => {
    const target = join(dir, 'remediation', 'uat', 'round-01', 'R01-UAT.md');
    const path = await writeUat({
      phaseDir: dir,
      path: target,
      doc: {
        phase: '01',
        plan_count: 1,
        status: 'failed',
        started: '2026-05-06',
        completed: '2026-05-06',
        total_tests: 1,
        passed: 0,
        skipped: 0,
        issues: 1,
        tests: [{ id: 'T1', description: 'Failing', status: 'fail', notes: '' }],
        issue_records: [
          { id: 'I1', severity: 'major', summary: 'broken', details: 'detail' },
        ],
        body: '',
      },
    });
    expect(path).toBe(target);
    expect((await readFile(path, 'utf8')).toString()).toContain('FAILED');
  });
});
