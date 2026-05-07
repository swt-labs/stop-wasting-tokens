import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runArchiveAudit } from '../../src/audit/audit.js';

let planningDir: string;

beforeEach(async () => {
  planningDir = await mkdtemp(join(tmpdir(), 'swt-audit-'));
  await mkdir(join(planningDir, 'phases', '01-setup'), { recursive: true });
});

afterEach(async () => {
  await rm(planningDir, { recursive: true, force: true });
});

async function seed(opts: {
  roadmapPhases?: string[];
  goalForFirst?: string;
  hasPlan?: boolean;
  hasSummary?: boolean;
  summaryStatus?: string;
  verificationResult?: string;
  uatStatus?: string;
  uatIssues?: number;
  reqs?: string[];
  roadmapReqs?: string[];
}): Promise<void> {
  const phaseLines = (opts.roadmapPhases ?? ['Setup']).map((name, i) =>
    [`## Phase ${i + 1}: ${name}`, `Goal: ${opts.goalForFirst ?? 'Configure stuff'}`, ''].join(
      '\n',
    ),
  );
  const reqRows = (opts.roadmapReqs ?? ['REQ-01']).map((id) => `| ${id} | mapped |`).join('\n');
  await writeFile(
    join(planningDir, 'ROADMAP.md'),
    [
      '# Roadmap',
      '',
      ...phaseLines,
      '## Requirement Mapping',
      '',
      '| REQ | Phase |',
      '|-----|-------|',
      reqRows,
      '',
    ].join('\n'),
    'utf8',
  );
  const reqs = opts.reqs ?? ['REQ-01'];
  await writeFile(
    join(planningDir, 'REQUIREMENTS.md'),
    ['# Requirements', '', ...reqs.map((r) => `- ${r}: details`)].join('\n'),
    'utf8',
  );

  const phaseDir = join(planningDir, 'phases', '01-setup');
  if (opts.hasPlan !== false) {
    await writeFile(
      join(phaseDir, '01-01-PLAN.md'),
      '---\nphase: "01"\nplan: "01"\n---\n# x\n',
      'utf8',
    );
  }
  if (opts.hasSummary !== false) {
    await writeFile(
      join(phaseDir, '01-01-SUMMARY.md'),
      `---\nphase: "01"\nplan: "01"\nstatus: ${opts.summaryStatus ?? 'complete'}\n---\n`,
      'utf8',
    );
  }
  if (opts.verificationResult !== undefined) {
    await writeFile(
      join(phaseDir, '01-VERIFICATION.md'),
      `---\nphase: "01"\nresult: ${opts.verificationResult}\n---\n`,
      'utf8',
    );
  }
  if (opts.uatStatus !== undefined) {
    await writeFile(
      join(phaseDir, '01-UAT.md'),
      `---\nphase: "01"\nstatus: ${opts.uatStatus}\nissues: ${opts.uatIssues ?? 0}\n---\n`,
      'utf8',
    );
  }
}

describe('runArchiveAudit', () => {
  it('passes when every check is green', async () => {
    await seed({
      verificationResult: 'PASS',
      uatStatus: 'complete',
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.status).toBe('pass');
  });

  it('warns when VERIFICATION.md is missing', async () => {
    await seed({ uatStatus: 'complete' });
    const out = await runArchiveAudit({ planningDir });
    const verification = out.checks.find((c) => c.id === 'verification');
    expect(verification?.status).toBe('warn');
  });

  it('fails when roadmap goal is TBD', async () => {
    await seed({
      goalForFirst: 'TBD',
      verificationResult: 'PASS',
      uatStatus: 'complete',
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.status).toBe('fail');
    expect(out.checks.find((c) => c.id === 'roadmap_completeness')?.status).toBe('fail');
  });

  it('fails when SUMMARY.md status is not complete', async () => {
    await seed({
      summaryStatus: 'partial',
      verificationResult: 'PASS',
      uatStatus: 'complete',
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.checks.find((c) => c.id === 'execution_status')?.status).toBe('fail');
  });

  it('fails when VERIFICATION.md result is fail', async () => {
    await seed({
      verificationResult: 'FAIL',
      uatStatus: 'complete',
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.checks.find((c) => c.id === 'verification')?.status).toBe('fail');
  });

  it('fails when UAT.md status is issues_found', async () => {
    await seed({
      verificationResult: 'PASS',
      uatStatus: 'issues_found',
      uatIssues: 1,
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.checks.find((c) => c.id === 'uat_status')?.status).toBe('fail');
  });

  it('fails when a roadmap REQ-ID is missing from REQUIREMENTS.md', async () => {
    await seed({
      verificationResult: 'PASS',
      uatStatus: 'complete',
      reqs: [],
      roadmapReqs: ['REQ-99'],
    });
    const out = await runArchiveAudit({ planningDir });
    expect(out.checks.find((c) => c.id === 'requirements_coverage')?.status).toBe('fail');
  });

  it('skipNonUatChecks ignores non-UAT failures', async () => {
    await seed({
      verificationResult: 'FAIL',
      uatStatus: 'complete',
    });
    const out = await runArchiveAudit({ planningDir, skipNonUatChecks: true });
    // verification still reports fail, but aggregate ignores non-UAT failures.
    expect(out.checks.find((c) => c.id === 'verification')?.status).toBe('fail');
    expect(out.status).not.toBe('fail');
  });
});
