import { Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentSpec } from '@swt-labs/core';

import { executeHandler } from '../../../src/vibe/handlers/execute.js';
import type { VibeRoute } from '../../../src/vibe/route.js';
import { MockAgentSpawner } from '../../../../core/test/mock-driver.js';

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

function makeIO() {
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

const devSpec: AgentSpec = {
  role: 'dev',
  model: 'mock',
  reasoning_effort: 'balanced',
  developer_instructions: 'mock',
  allowed_mcp_servers: [],
};

async function seedPlan(plan: string, opts: { wave?: number; files?: string[] } = {}): Promise<void> {
  const lines: string[] = [];
  lines.push('---');
  lines.push('phase: "01"');
  lines.push(`plan: "${plan}"`);
  lines.push(`title: "plan ${plan}"`);
  lines.push(`wave: ${opts.wave ?? 1}`);
  lines.push('depends_on: []');
  if (opts.files !== undefined) {
    lines.push('files_modified:');
    for (const f of opts.files) lines.push(`  - ${JSON.stringify(f)}`);
  }
  lines.push('---');
  lines.push('# plan');
  await writeFile(join(phaseDir, `01-${plan}-PLAN.md`), lines.join('\n'), 'utf8');
}

describe('executeHandler', () => {
  it('throws NotImplementedError when no spawner is supplied', async () => {
    await seedPlan('01');
    const handler = executeHandler();
    const { io } = makeIO();
    await expect(handler.run(route, io)).rejects.toThrow(/Real Codex AgentSpawner/);
  });

  it('runs each plan via the mock spawner and writes SUMMARY.md', async () => {
    await seedPlan('01');
    await seedPlan('02');
    const handler = executeHandler({
      spawner: new MockAgentSpawner(),
      devSpec,
      sessionId: 'sess-test',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    const sum1 = await readFile(join(phaseDir, '01-01-SUMMARY.md'), 'utf8');
    const sum2 = await readFile(join(phaseDir, '01-02-SUMMARY.md'), 'utf8');
    expect(sum1).toContain('plan: "01"');
    expect(sum2).toContain('plan: "02"');
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
    const handler = executeHandler({
      spawner: new MockAgentSpawner(),
      devSpec,
      sessionId: 'sess-test',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('already have SUMMARY.md');
  });

  it('rejects same-wave plans with overlapping files_modified', async () => {
    await seedPlan('01', { files: ['a.ts'] });
    await seedPlan('02', { files: ['a.ts'] });
    const handler = executeHandler({
      spawner: new MockAgentSpawner(),
      devSpec,
    });
    const { io } = makeIO();
    await expect(handler.run(route, io)).rejects.toThrow(/files_modified/);
  });
});
