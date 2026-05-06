import { Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotImplementedError } from '../../../src/vibe/errors.js';
import { bootstrapHandler } from '../../../src/vibe/handlers/bootstrap.js';

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
  cwd = await mkdtemp(join(tmpdir(), 'swt-bootstrap-handler-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

describe('bootstrapHandler', () => {
  it('throws NotImplementedError when no input is supplied', async () => {
    const handler = bootstrapHandler({ resolve: async () => undefined });
    const { io } = makeIO();
    await expect(
      handler.run({ kind: 'bootstrap', requires_confirmation: true }, io),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('writes the four planning artefacts when input is supplied', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    const handler = bootstrapHandler({
      resolve: async () => ({
        project_name: 'swt-test',
        description: 'Token-disciplined SDLC',
        core_value: 'Stop wasting tokens',
      }),
    });
    const { io, stdout } = makeIO();
    const result = await handler.run({ kind: 'bootstrap', requires_confirmation: true }, io);
    expect(result.exit).toBe(0);
    expect(result.ranTo).toBe('completion');
    expect(stdout.text()).toContain('✓ Bootstrap complete');

    const planning = join(cwd, '.swt-planning');
    expect((await readFile(join(planning, 'PROJECT.md'), 'utf8')).toString()).toContain('# swt-test');
    expect((await readFile(join(planning, 'REQUIREMENTS.md'), 'utf8')).toString()).toContain('# swt-test Requirements');
    expect((await readFile(join(planning, 'ROADMAP.md'), 'utf8')).toString()).toContain('# swt-test Roadmap');
    expect((await readFile(join(planning, 'STATE.md'), 'utf8')).toString()).toContain('**Project:** swt-test');
    expect((await readFile(join(cwd, 'CLAUDE.md'), 'utf8')).toString()).toContain('# swt-test');
  });

  it('preserves an existing CLAUDE.md', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(cwd, 'CLAUDE.md'), '# my-project\n\n## Build commands\n\npnpm install\n', 'utf8'),
    );
    const handler = bootstrapHandler({
      resolve: async () => ({ project_name: 'my-project', description: 'desc' }),
    });
    const { io } = makeIO();
    await handler.run({ kind: 'bootstrap', requires_confirmation: true }, io);
    const raw = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(raw).toContain('## Build commands');
    expect(raw).toContain('pnpm install');
    expect(raw).toContain('## Active Context');
  });

  it('does not throw when discovery.json is absent and creates an empty one', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    const handler = bootstrapHandler({
      resolve: async () => ({ project_name: 'p', description: 'd' }),
    });
    const { io } = makeIO();
    await handler.run({ kind: 'bootstrap', requires_confirmation: true }, io);
    const discovery = await readFile(join(cwd, '.swt-planning', 'discovery.json'), 'utf8');
    const parsed = JSON.parse(discovery) as Record<string, unknown>;
    expect(parsed).toMatchObject({ answered: [], inferred: [], deferred: [] });
  });
});
