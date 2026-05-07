import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScriptedPrompter } from '../../../../core/test/mock-driver.js';
import { verifyHandler } from '../../../src/vibe/handlers/verify.js';
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

const route: VibeRoute = {
  kind: 'verify',
  phase: '01',
  phase_slug: '01-setup',
  qa_pending: false,
  qa_pending_reason: undefined,
  requires_confirmation: false,
};

let cwd: string;
let phaseDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-verify-handler-'));
  phaseDir = join(cwd, '.swt-planning', 'phases', '01-setup');
  await mkdir(phaseDir, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function seedPlan(plan: string, mustHaves: string[]): Promise<void> {
  const lines = [
    '---',
    'phase: "01"',
    `plan: "${plan}"`,
    `title: "Plan ${plan}"`,
    'wave: 1',
    'depends_on: []',
    'must_haves:',
    ...mustHaves.map((mh) => `  - ${JSON.stringify(mh)}`),
    '---',
    `# Plan ${plan}`,
  ];
  await writeFile(join(phaseDir, `01-${plan}-PLAN.md`), lines.join('\n'), 'utf8');
}

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

describe('verifyHandler', () => {
  it('synthesizes UAT.md with deferred rows from PLAN must_haves', async () => {
    await seedPlan('01', ['LICENSE present', 'README present']);
    await seedPlan('02', ['CI workflow exists']);
    const handler = verifyHandler({ today: () => '2026-05-06' });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('01-UAT.md');

    const raw = await readFile(join(phaseDir, '01-UAT.md'), 'utf8');
    expect(raw).toContain('plan_count: 2');
    expect(raw).toContain('total_tests: 3');
    expect(raw).toContain('| P01-MH01 | LICENSE present | DEFERRED');
    expect(raw).toContain('| P02-MH01 | CI workflow exists | DEFERRED');
    expect(raw).toContain('issues: 0');
  });

  it('throws when no PLAN.md files exist', async () => {
    const handler = verifyHandler({ today: () => '2026-05-06' });
    const { io } = makeIO();
    await expect(handler.run(route, io)).rejects.toThrow(/no PLAN\.md/);
  });

  it('runs the inline checkpoint loop with a scripted prompter (all pass)', async () => {
    await seedPlan('01', ['A', 'B']);
    const prompter = new ScriptedPrompter([
      { kind: 'choice', value: 'pass' },
      { kind: 'choice', value: 'pass' },
    ]);
    const handler = verifyHandler({ today: () => '2026-05-06', prompter });
    const { io } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    const raw = await readFile(join(phaseDir, '01-UAT.md'), 'utf8');
    expect(raw).toContain('passed: 2');
    expect(raw).toContain('issues: 0');
    expect(raw).toContain('| P01-MH01 | A | PASS');
    expect(prompter.remaining()).toBe(0);
  });

  it('captures issue records on FAIL with severity prompt', async () => {
    await seedPlan('01', ['Login works']);
    const prompter = new ScriptedPrompter([
      { kind: 'choice', value: 'fail' },
      { kind: 'text', value: '500 error on submit' },
      { kind: 'choice', value: 'major' },
    ]);
    const handler = verifyHandler({ today: () => '2026-05-06', prompter });
    const { io } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(1);
    const raw = await readFile(join(phaseDir, '01-UAT.md'), 'utf8');
    expect(raw).toContain('issues: 1');
    expect(raw).toContain('### I-01-P01-MH01 — MAJOR');
    expect(raw).toContain('500 error on submit');
    expect(raw).toContain('FAILED');
  });

  it('pure-vibe autonomy short-circuits the prompter', async () => {
    await seedPlan('01', ['Test row']);
    const prompter = new ScriptedPrompter([]); // would throw if asked
    const handler = verifyHandler({
      today: () => '2026-05-06',
      prompter,
      autonomy: 'pure-vibe',
    });
    const { io } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(prompter.remaining()).toBe(0);
  });
});
