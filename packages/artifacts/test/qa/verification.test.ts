import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readVerification, writeVerification } from '../../src/qa/verification.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-verification-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('verification artifact', () => {
  it('writes + reads back a passing verification doc with checks', async () => {
    const path = await writeVerification({
      phaseDir: dir,
      doc: {
        phase: '01',
        tier: 'standard',
        result: 'pass',
        passed: 2,
        failed: 0,
        total: 2,
        date: '2026-05-06',
        plans_verified: ['01'],
        verified_at_commit: 'abc1234',
        checks: [
          {
            id: 'AC1',
            must_have: 'README present',
            status: 'pass',
            evidence: 'README.md exists',
          },
          {
            id: 'AC2',
            must_have: 'LICENSE present',
            status: 'pass',
            evidence: 'LICENSE exists',
          },
        ],
        pre_existing_issues: [],
        body: '',
      },
    });

    expect(path.endsWith('01-VERIFICATION.md')).toBe(true);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('result: "PASS"');
    expect(raw).toContain('| AC1 | README present | PASS |');
    expect(raw).toContain('verified_at_commit: "abc1234"');

    const round = await readVerification(dir, '01');
    expect(round.phase).toBe('01');
    expect(round.result).toBe('pass');
    expect(round.passed).toBe(2);
    expect(round.checks).toHaveLength(2);
    expect(round.checks[0]?.id).toBe('AC1');
    expect(round.plans_verified).toEqual(['01']);
    expect(round.verified_at_commit).toBe('abc1234');
  });

  it('reads back a block-style YAML array', async () => {
    const raw = `---
phase: "09"
tier: standard
result: PASS
passed: 4
failed: 0
total: 4
date: 2026-05-06
plans_verified:
  - "01"
  - "02"
  - "03"
  - "04"
verified_at_commit: deadbee
---

# Phase 9 Verification

| ID | Must-have | Status | Evidence |
|----|-----------|--------|----------|
| AC1 | All four plans complete | PASS | summaries on disk |
`;
    await writeFile(join(dir, '09-VERIFICATION.md'), raw, 'utf8');

    const doc = await readVerification(dir, '09');
    expect(doc.plans_verified).toEqual(['01', '02', '03', '04']);
    expect(doc.passed).toBe(4);
    expect(doc.checks).toHaveLength(1);
    expect(doc.checks[0]?.id).toBe('AC1');
  });

  it('lowercases uppercase result tokens for round-trip', async () => {
    await writeVerification({
      phaseDir: dir,
      doc: {
        phase: '02',
        tier: 'minimal',
        result: 'partial',
        passed: 1,
        failed: 1,
        total: 2,
        date: '2026-05-06',
        plans_verified: ['01'],
        verified_at_commit: 'feedface',
        checks: [],
        pre_existing_issues: [],
        body: '',
      },
    });
    const doc = await readVerification(dir, '02');
    expect(doc.result).toBe('partial');
  });
});
