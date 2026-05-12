// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScriptedPrompter } from '../../../../core/test/mock-driver.js';
import { NotImplementedError } from '../../../src/vibe/errors.js';
import { bootstrapHandler } from '../../../src/vibe/handlers/bootstrap.js';

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

describe.skip('bootstrapHandler', () => {
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
    expect((await readFile(join(planning, 'PROJECT.md'), 'utf8')).toString()).toContain(
      '# swt-test',
    );
    expect((await readFile(join(planning, 'REQUIREMENTS.md'), 'utf8')).toString()).toContain(
      '# swt-test Requirements',
    );
    expect((await readFile(join(planning, 'ROADMAP.md'), 'utf8')).toString()).toContain(
      '# swt-test Roadmap',
    );
    expect((await readFile(join(planning, 'STATE.md'), 'utf8')).toString()).toContain(
      '**Project:** swt-test',
    );
    const agentsMd = (await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toString();
    expect(agentsMd).toContain('<!-- SWT BEGIN -->');
    expect(agentsMd).toContain('<!-- SWT END -->');
    expect(agentsMd).toContain('**Core value:** Stop wasting tokens');
    expect(agentsMd).toContain('## Active Context');
    expect(agentsMd).toContain('## SWT Rules');
    expect(agentsMd).not.toContain('## VBW Rules');
  });

  it('preserves user content outside the SWT fence in an existing AGENTS.md', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        join(cwd, 'AGENTS.md'),
        '# my-project\n\n## Build commands\n\npnpm install\n',
        'utf8',
      ),
    );
    const handler = bootstrapHandler({
      resolve: async () => ({ project_name: 'my-project', description: 'desc' }),
    });
    const { io } = makeIO();
    await handler.run({ kind: 'bootstrap', requires_confirmation: true }, io);
    const raw = await readFile(join(cwd, 'AGENTS.md'), 'utf8');
    expect(raw).toContain('# my-project');
    expect(raw).toContain('## Build commands');
    expect(raw).toContain('pnpm install');
    expect(raw).toContain('<!-- SWT BEGIN -->');
    expect(raw).toContain('<!-- SWT END -->');
    expect(raw).toContain('## SWT Rules');
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

  it('runs the discussion engine when no JSON input + a prompter is supplied', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    const prompter = new ScriptedPrompter([
      { kind: 'text', value: 'swt-test' }, // project_name
      { kind: 'text', value: 'Token-disciplined SDLC' }, // description
      { kind: 'text', value: 'Stop wasting tokens' }, // core_value
      { kind: 'choice', value: 'mit' },
      { kind: 'choice', value: 'just-me' },
    ]);
    const handler = bootstrapHandler({
      resolve: async () => undefined,
      prompter,
    });
    const { io, stdout } = makeIO();
    const result = await handler.run({ kind: 'bootstrap', requires_confirmation: true }, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('Bootstrap complete');
    const project = await readFile(join(cwd, '.swt-planning', 'PROJECT.md'), 'utf8');
    expect(project).toContain('# swt-test');
  });
});
