import { Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotImplementedError } from '../../../src/vibe/errors.js';
import { scopeHandler } from '../../../src/vibe/handlers/scope.js';
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

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-scope-handler-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

describe('scopeHandler', () => {
  it('throws NotImplementedError when no scope input is supplied', async () => {
    const handler = scopeHandler({ resolve: async () => undefined });
    const { io } = makeIO();
    await expect(
      handler.run({ kind: 'scope', requires_confirmation: true }, io),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('creates phase dirs, writes ROADMAP/STATE/CONTEXT from a scope input', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    const handler = scopeHandler({
      resolve: async () => ({
        project_name: 'swt',
        milestone_name: 'mvp',
        scope_boundary: 'Cover bootstrap-through-archive',
        decomposition_rationale: 'Two-phase split',
        phases: [
          {
            position: '01',
            slug: 'setup',
            name: 'Setup',
            goal: 'Stand up the workspace',
            requirements: ['REQ-01'],
            success_criteria: ['CI green'],
            status: 'pending',
          },
          {
            position: '02',
            slug: 'foundation',
            name: 'Foundation',
            goal: 'Compile + test',
            requirements: [],
            success_criteria: [],
            status: 'pending',
          },
        ],
      }),
    });
    const { io, stdout } = makeIO();
    const result = await handler.run({ kind: 'scope', requires_confirmation: true }, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('✓ Scope complete — 2 phases created');

    const planning = join(cwd, '.swt-planning');
    expect((await stat(join(planning, 'phases', '01-setup'))).isDirectory()).toBe(true);
    expect((await stat(join(planning, 'phases', '02-foundation'))).isDirectory()).toBe(true);
    const roadmap = await readFile(join(planning, 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('## Phase 1: Setup');
    expect(roadmap).toContain('## Phase 2: Foundation');
    const state = await readFile(join(planning, 'STATE.md'), 'utf8');
    expect(state).toContain('**Milestone:** mvp');
    expect(state).toContain('Phase: 1 of 2');
    const context = await readFile(join(planning, 'CONTEXT.md'), 'utf8');
    expect(context).toContain('# mvp');
    expect(context).toContain('Cover bootstrap-through-archive');
    expect(context).toContain('Phase 01: REQ-01');
  });

  it('rejects malformed scope input', async () => {
    const handler = scopeHandler({
      resolve: async () =>
        // @ts-expect-error — purposely malformed
        ({ project_name: 'x' }),
    });
    const { io } = makeIO();
    await expect(
      handler.run({ kind: 'scope', requires_confirmation: true }, io),
    ).rejects.toThrow();
  });

  it('runs the discussion engine when no JSON input + a prompter is supplied', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    const prompter = new ScriptedPrompter([
      // Engine gray-area answers (scope mode, builder calibration):
      { kind: 'text', value: 'mvp' }, // milestone_name
      { kind: 'text', value: 'Cover bootstrap-through-archive' }, // scope_boundary
      { kind: 'text', value: 'Two-phase split' }, // decomposition_rationale
      { kind: 'choice', value: '3' }, // phase_count (recommendation)
      { kind: 'text', value: 'defer' }, // deferred_ideas
      // Then phase questions (3 phases × 2 prompts each):
      { kind: 'text', value: 'Setup' },
      { kind: 'text', value: 'Stand up the workspace' },
      { kind: 'text', value: 'Foundation' },
      { kind: 'text', value: 'Compile and test' },
      { kind: 'text', value: 'Polish' },
      { kind: 'text', value: 'Final touches' },
    ]);
    const handler = scopeHandler({
      resolve: async () => undefined,
      prompter,
      projectNameFallback: 'swt-test',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run({ kind: 'scope', requires_confirmation: true }, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('Scope complete — 3 phases created');
    const roadmap = await readFile(join(cwd, '.swt-planning', 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('## Phase 1: Setup');
    expect(roadmap).toContain('## Phase 3: Polish');
  });
});
