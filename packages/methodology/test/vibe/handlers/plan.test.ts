import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planHandler } from '../../../src/vibe/handlers/plan.js';
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
  cwd = await mkdtemp(join(tmpdir(), 'swt-plan-handler-'));
  phaseDir = join(cwd, '.swt-planning', 'phases', '01-setup');
  await mkdir(phaseDir, { recursive: true });
  await writeFile(
    join(cwd, '.swt-planning', 'ROADMAP.md'),
    [
      '# swt Roadmap',
      '',
      '## Phase 1: Setup',
      '',
      '**Goal:** Stand up the workspace',
      '',
      '**Success Criteria:**',
      '- LICENSE present',
      '- README has TL;DR',
      '- CI green',
      '',
      '---',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

const planRoute: VibeRoute = {
  kind: 'plan-and-execute',
  phase: '01',
  phase_slug: '01-setup',
  requires_confirmation: true,
};

describe('planHandler', () => {
  it('writes one PLAN.md file per bucket of must-haves', async () => {
    const handler = planHandler({ effort: 'balanced' });
    const { io } = makeIO();
    const result = await handler.run(planRoute, io);
    expect(result.exit).toBe(0);
    const files = await readdir(phaseDir);
    const plans = files.filter((f) => f.startsWith('01-') && f.endsWith('-PLAN.md'));
    expect(plans).toHaveLength(1); // 3 must-haves, max 5 per plan → 1 plan
    const raw = await readFile(join(phaseDir, plans[0] ?? ''), 'utf8');
    expect(raw).toContain('phase: "01"');
    expect(raw).toContain('plan: "01"');
    expect(raw).toContain('wave: 1');
    expect(raw).toContain('LICENSE present');
    expect(raw).toContain('README has TL;DR');
    expect(raw).toContain('CI green');
  });

  it('is idempotent when plans already exist', async () => {
    await writeFile(
      join(phaseDir, '01-01-PLAN.md'),
      '---\nphase: "01"\nplan: "01"\ntitle: "existing"\nwave: 1\n---\n',
      'utf8',
    );
    const handler = planHandler();
    const { io, stdout } = makeIO();
    const result = await handler.run(planRoute, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('already has 1 plan');
    const files = await readdir(phaseDir);
    expect(files.filter((f) => f.endsWith('-PLAN.md'))).toHaveLength(1);
  });
});
