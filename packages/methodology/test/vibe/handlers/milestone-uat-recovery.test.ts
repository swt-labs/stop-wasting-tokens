import { Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { milestoneUatRecoveryHandler } from '../../../src/vibe/handlers/milestone-uat-recovery.js';
import type { VibeRoute } from '../../../src/vibe/route.js';
import { ScriptedPrompter } from '../../../../core/test/mock-driver.js';

class StringStream extends Writable {
  public readonly chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (e?: Error | null) => void): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
  text(): string {
    return this.chunks.join('');
  }
}

const route: VibeRoute = {
  kind: 'milestone-uat-recovery',
  requires_confirmation: false,
};

let cwd: string;
let milestoneDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-milestone-uat-'));
  milestoneDir = join(cwd, '.swt-planning', 'milestones', '01-shipped');
  await mkdir(join(milestoneDir, 'phases', '01-foundation'), { recursive: true });
  await mkdir(join(milestoneDir, 'phases', '02-feature'), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function seedUat(
  phaseDir: string,
  phase: string,
  status: string,
  issues: number,
  major = false,
): Promise<void> {
  const lines = [
    '---',
    `phase: "${phase}"`,
    `status: ${status}`,
    `issues: ${issues}`,
    'plan_count: 1',
    'started: 2026-05-06',
    'completed: 2026-05-06',
    'total_tests: 1',
    'passed: 0',
    'skipped: 0',
    '---',
    '# UAT',
    '',
  ];
  if (major) lines.push('### I1 — MAJOR\n\nbroken\n');
  await writeFile(join(phaseDir, `${phase}-UAT.md`), lines.join('\n'), 'utf8');
}

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

describe('milestoneUatRecoveryHandler', () => {
  it('returns clean when no unresolved issues are found', async () => {
    await seedUat(join(milestoneDir, 'phases', '01-foundation'), '01', 'complete', 0);
    await seedUat(join(milestoneDir, 'phases', '02-feature'), '02', 'complete', 0);
    const handler = milestoneUatRecoveryHandler();
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('no unresolved issues');
  });

  it('honors forceDecision=start-fresh and writes .remediated markers', async () => {
    await seedUat(join(milestoneDir, 'phases', '01-foundation'), '01', 'issues_found', 1, true);
    await seedUat(join(milestoneDir, 'phases', '02-feature'), '02', 'issues_found', 2, true);

    const handler = milestoneUatRecoveryHandler({
      forceDecision: 'start-fresh',
      today: () => '2026-05-06',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('start-fresh');

    const m1 = await stat(join(milestoneDir, 'phases', '01-foundation', '.remediated'));
    expect(m1.isFile()).toBe(true);
    const m2 = await stat(join(milestoneDir, 'phases', '02-feature', '.remediated'));
    expect(m2.isFile()).toBe(true);

    const raw = await readFile(
      join(milestoneDir, 'phases', '01-foundation', '.remediated'),
      'utf8',
    );
    expect(raw).toContain('acknowledged_at: 2026-05-06');
  });

  it('returns create-remediation decision via scripted prompter', async () => {
    await seedUat(join(milestoneDir, 'phases', '01-foundation'), '01', 'issues_found', 1, true);
    const prompter = new ScriptedPrompter([
      { kind: 'choice', value: 'create-remediation' },
    ]);
    const handler = milestoneUatRecoveryHandler({ prompter });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('create-remediation');
    expect(result.message).toContain('"decision":"create-remediation"');
    expect(result.message).toContain('"phase":"01"');
  });

  it('skips when prompter returns skip and writes no markers', async () => {
    await seedUat(join(milestoneDir, 'phases', '01-foundation'), '01', 'issues_found', 1, true);
    const prompter = new ScriptedPrompter([{ kind: 'choice', value: 'skip' }]);
    const handler = milestoneUatRecoveryHandler({ prompter });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('skipped');
    await expect(
      stat(join(milestoneDir, 'phases', '01-foundation', '.remediated')),
    ).rejects.toThrow();
  });

  it('skips phases with .remediated marker', async () => {
    await seedUat(join(milestoneDir, 'phases', '01-foundation'), '01', 'issues_found', 1, true);
    await writeFile(
      join(milestoneDir, 'phases', '01-foundation', '.remediated'),
      'acknowledged_at: 2026-05-05\n',
      'utf8',
    );
    await seedUat(join(milestoneDir, 'phases', '02-feature'), '02', 'issues_found', 1, true);

    const handler = milestoneUatRecoveryHandler({
      forceDecision: 'start-fresh',
      today: () => '2026-05-06',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('1 affected phase(s)'); // only phase 02
  });
});
