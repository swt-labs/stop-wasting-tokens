import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { HarvestStrategy, PiSessionEntryLike } from '@swt-labs/orchestration';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeHandler } from '../../../src/vibe/handlers/execute.js';
import { buildTaskId } from '../../../src/vibe/orchestration/dev-runner.js';
import type { VibeRoute } from '../../../src/vibe/route.js';

class StringStream extends Writable {
  public readonly chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (e?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
  text(): string {
    return this.chunks.join('');
  }
}

let cwd: string;
let phaseDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-execute-handler-'));
  phaseDir = join(cwd, '.swt-planning', 'phases', '01-setup');
  await mkdir(phaseDir, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function makeIO(): {
  io: { cwd: string; stdout: StringStream; stderr: StringStream };
  stdout: StringStream;
  stderr: StringStream;
} {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

const route: VibeRoute = {
  kind: 'execute',
  phase: '01',
  phase_slug: '01-setup',
  requires_confirmation: true,
};

async function seedPlan(
  plan: string,
  opts: { wave?: number; files?: string[]; depends_on?: string[] } = {},
): Promise<void> {
  const lines: string[] = [];
  lines.push('---');
  lines.push('phase: "01"');
  lines.push(`plan: "${plan}"`);
  lines.push(`title: "plan ${plan}"`);
  lines.push(`wave: ${opts.wave ?? 1}`);
  lines.push(`depends_on: ${JSON.stringify(opts.depends_on ?? [])}`);
  if (opts.files !== undefined) {
    lines.push('files_modified:');
    for (const f of opts.files) lines.push(`  - ${JSON.stringify(f)}`);
  }
  lines.push('---');
  lines.push('# plan');
  await writeFile(join(phaseDir, `01-${plan}-PLAN.md`), lines.join('\n'), 'utf8');
}

function successHarvest(): HarvestStrategy {
  return {
    kind: 'entries',
    getEntries: (task): PiSessionEntryLike[] => [
      {
        type: 'custom',
        customType: 'swt-task-result',
        data: {
          schema_version: 1,
          task_id: task.taskId,
          status: 'success',
          summary: `dev run for ${task.taskId}`,
          files_changed: [{ path: `src/${task.taskId}.ts`, action: 'modified' }],
          must_haves: [],
        },
      },
    ],
  };
}

function failingHarvest(failOnTaskId: string): HarvestStrategy {
  return {
    kind: 'entries',
    getEntries: (task): PiSessionEntryLike[] => [
      {
        type: 'custom',
        customType: 'swt-task-result',
        data: {
          schema_version: 1,
          task_id: task.taskId,
          status: task.taskId === failOnTaskId ? 'failed' : 'success',
          summary:
            task.taskId === failOnTaskId
              ? `simulated failure for ${task.taskId}`
              : `dev run for ${task.taskId}`,
          files_changed: [],
          must_haves: [],
          blockers: task.taskId === failOnTaskId ? ['simulated'] : undefined,
        },
      },
    ],
  };
}

describe('executeHandler', () => {
  it('dispatches each plan through the orchestration dispatcher and writes SUMMARY.md', async () => {
    await seedPlan('01');
    await seedPlan('02');
    const handler = executeHandler({ harvestStrategy: successHarvest() });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    const sum1 = await readFile(join(phaseDir, '01-01-SUMMARY.md'), 'utf8');
    const sum2 = await readFile(join(phaseDir, '01-02-SUMMARY.md'), 'utf8');
    expect(sum1).toContain('plan: "01"');
    expect(sum1).toContain('status: complete');
    expect(sum1).toContain(buildTaskId('01', '01'));
    expect(sum2).toContain('plan: "02"');
    expect(sum2).toContain('status: complete');
    expect(stdout.text()).toContain('Wave 1');
    expect(stdout.text()).toContain('2 plan(s) processed');
  });

  it('skips plans that already have a SUMMARY.md', async () => {
    await seedPlan('01');
    await writeFile(
      join(phaseDir, '01-01-SUMMARY.md'),
      '---\nphase: "01"\nplan: "01"\nstatus: complete\ntasks_completed: 1\ntasks_total: 1\n---\n',
      'utf8',
    );
    const handler = executeHandler({ harvestStrategy: successHarvest() });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('already have SUMMARY.md');
  });

  it('rejects same-wave plans with overlapping files_modified', async () => {
    await seedPlan('01', { files: ['a.ts'] });
    await seedPlan('02', { files: ['a.ts'] });
    const handler = executeHandler({ harvestStrategy: successHarvest() });
    const { io } = makeIO();
    await expect(handler.run(route, io)).rejects.toThrow(/files_modified/);
  });

  it('halts after a failed Dev TaskResult and surfaces the halt reason on stdout', async () => {
    await seedPlan('01', { wave: 1 });
    await seedPlan('02', { wave: 2, depends_on: ['01'] });
    const handler = executeHandler({
      harvestStrategy: failingHarvest(buildTaskId('01', '01')),
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(1);
    expect(stdout.text()).toContain('Dev run halted');
    expect(stdout.text()).toContain('plan 01 returned status=failed');
    // Plan 02 (wave 2) must NOT be dispatched after wave 1 halts.
    await expect(readFile(join(phaseDir, '01-02-SUMMARY.md'), 'utf8')).rejects.toThrow();
    // Plan 01's failed result still wrote a SUMMARY.md so the wave-1 outcome is durable.
    const sum1 = await readFile(join(phaseDir, '01-01-SUMMARY.md'), 'utf8');
    expect(sum1).toContain('status: failed');
  });

  it('returns exit=0 when there are no pending plans (all SUMMARY.md present)', async () => {
    await seedPlan('01');
    await writeFile(
      join(phaseDir, '01-01-SUMMARY.md'),
      '---\nphase: "01"\nplan: "01"\nstatus: complete\ntasks_completed: 1\ntasks_total: 1\n---\n',
      'utf8',
    );
    const handler = executeHandler();
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('all 1 plan(s) already have SUMMARY.md');
  });
});
