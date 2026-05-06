import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeVerification } from '@swt-labs/artifacts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkQaFreshness } from '../../src/qa/freshness.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-freshness-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(commit: string, result: 'pass' | 'fail' | 'partial' = 'pass'): Promise<void> {
  await writeVerification({
    phaseDir: dir,
    doc: {
      phase: '01',
      tier: 'standard',
      result,
      passed: 1,
      failed: result === 'fail' ? 1 : 0,
      total: 1,
      date: '2026-05-06',
      plans_verified: ['01'],
      verified_at_commit: commit,
      checks: [],
      pre_existing_issues: [],
      body: '',
    },
  });
}

describe('checkQaFreshness (handler-side)', () => {
  it('returns pending when VERIFICATION.md is missing', async () => {
    const out = await checkQaFreshness({
      phaseDir: dir,
      phase: '99',
      cwd: dir,
      allowGit: false,
    });
    expect(out.status).toBe('pending');
    expect(out.reason).toBe('missing_verification_artifact');
  });

  it('returns failed when verification result is fail', async () => {
    await seed('abc1234', 'fail');
    const out = await checkQaFreshness({
      phaseDir: dir,
      phase: '01',
      cwd: dir,
      allowGit: false,
    });
    expect(out.status).toBe('failed');
  });

  it('returns pending when git lookup is disabled (baseline_unavailable)', async () => {
    await seed('abc1234', 'pass');
    const out = await checkQaFreshness({
      phaseDir: dir,
      phase: '01',
      cwd: dir,
      allowGit: false,
    });
    expect(out.status).toBe('pending');
    expect(out.reason).toBe('freshness_baseline_unavailable');
  });

  it('preserves verified_at_commit through the read path', async () => {
    await seed('feedface', 'pass');
    const out = await checkQaFreshness({
      phaseDir: dir,
      phase: '01',
      cwd: dir,
      allowGit: false,
    });
    expect(out.verifiedAtCommit).toBe('feedface');
  });
});
