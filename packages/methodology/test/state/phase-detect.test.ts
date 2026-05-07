import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toKeyValueLines } from '../../src/state/encode.js';
import { detectPhase } from '../../src/state/phase-detect.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-phase-detect-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function seedConfig(planningDir: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await mkdir(planningDir, { recursive: true });
  await writeFile(join(planningDir, 'config.json'), JSON.stringify(overrides), 'utf8');
}

async function seedPhase(
  planningDir: string,
  position: string,
  slug: string,
  files: Record<string, string>,
): Promise<void> {
  const phaseDir = join(planningDir, 'phases', `${position}-${slug}`);
  await mkdir(phaseDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(phaseDir, name), content, 'utf8');
  }
}

describe('detectPhase', () => {
  it('reports phase_count_zero on a fresh planning dir', async () => {
    await seedConfig(join(cwd, '.swt-planning'));
    await writeFile(join(cwd, '.swt-planning', 'PROJECT.md'), '# project\n', 'utf8');

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.planning_dir_exists).toBe(true);
    expect(result.project_exists).toBe(true);
    expect(result.phase_count).toBe(0);
    expect(result.next_phase_state).toBe('phase_count_zero');
  });

  it('reports planning_dir_exists=false when no planning dir is present', async () => {
    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.planning_dir_exists).toBe(false);
    expect(result.project_exists).toBe(false);
    expect(result.phase_count).toBe(0);
  });

  it('routes to needs_plan_and_execute when a phase has no plans', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning);
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {});

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase).toBe('01');
    expect(result.next_phase_state).toBe('needs_plan_and_execute');
  });

  it('routes to needs_execute when plans exist but summaries are missing', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning);
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {
      '01-01-PLAN.md': '---\nphase: "01"\nplan: "01"\n---\n',
    });

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase_state).toBe('needs_execute');
    expect(result.next_phase_plans).toBe(1);
    expect(result.next_phase_summaries).toBe(0);
  });

  it('routes to needs_verification when fully built but no UAT', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning, { auto_uat: true });
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {
      '01-01-PLAN.md': '---\nphase: "01"\nplan: "01"\n---\n',
      '01-01-SUMMARY.md': '---\nphase: "01"\nplan: "01"\nstatus: complete\n---\n',
    });

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase_state).toBe('needs_verification');
    expect(result.qa_status).toBe('pending');
    expect(result.qa_reason).toBe('missing_verification_artifact');
  });

  it('routes to needs_uat_remediation when UAT has issues', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning, { auto_uat: true });
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {
      '01-01-PLAN.md': '---\nphase: "01"\nplan: "01"\n---\n',
      '01-01-SUMMARY.md': '---\nphase: "01"\nplan: "01"\nstatus: complete\n---\n',
      '01-VERIFICATION.md': '---\nphase: "01"\nresult: PASS\n---\n',
      '01-UAT.md': '---\nphase: "01"\nstatus: issues_found\nmajor_or_higher: true\n---\n',
    });

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase_state).toBe('needs_uat_remediation');
    expect(result.uat_issues_count).toBe(1);
    expect(result.uat_issues_major_or_higher).toBe(true);
  });

  it('routes to needs_qa_remediation when VERIFICATION says FAIL', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning, { auto_uat: true });
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {
      '01-01-PLAN.md': '---\nphase: "01"\nplan: "01"\n---\n',
      '01-01-SUMMARY.md': '---\nphase: "01"\nplan: "01"\nstatus: complete\n---\n',
      '01-VERIFICATION.md': '---\nphase: "01"\nresult: FAIL\n---\n',
    });

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase_state).toBe('needs_qa_remediation');
    expect(result.qa_status).toBe('failed');
  });

  it('reaches all_done when QA passes and UAT is complete', async () => {
    const planning = join(cwd, '.swt-planning');
    await seedConfig(planning, { auto_uat: true });
    await writeFile(join(planning, 'PROJECT.md'), '# project\n', 'utf8');
    await seedPhase(planning, '01', 'foo', {
      '01-01-PLAN.md': '---\nphase: "01"\nplan: "01"\n---\n',
      '01-01-SUMMARY.md': '---\nphase: "01"\nplan: "01"\nstatus: complete\n---\n',
      '01-VERIFICATION.md': '---\nphase: "01"\nresult: PASS\n---\n',
      '01-UAT.md': '---\nphase: "01"\nstatus: complete\n---\n',
    });

    const result = await detectPhase({ cwd, allowGit: false });
    expect(result.next_phase_state).toBe('all_done');
  });

  it('encodes the result as bash-compatible key=value lines', async () => {
    await seedConfig(join(cwd, '.swt-planning'));
    await writeFile(join(cwd, '.swt-planning', 'PROJECT.md'), '# project\n', 'utf8');

    const result = await detectPhase({ cwd, allowGit: false });
    const lines = toKeyValueLines(result);
    expect(lines).toContain('phase_count=0');
    expect(lines).toContain('next_phase_state=phase_count_zero');
    expect(lines).toContain('phase_detect_complete=true');
    expect(lines).toContain('config_effort=balanced');
  });
});
