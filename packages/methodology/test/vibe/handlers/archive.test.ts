import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveHandler } from '../../../src/vibe/handlers/archive.js';
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

const route: VibeRoute = { kind: 'archive', requires_confirmation: true };

let cwd: string;
let planningDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-archive-'));
  planningDir = join(cwd, '.swt-planning');
  await mkdir(join(planningDir, 'phases', '01-setup'), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function makeIO() {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

async function seedHappyPath(): Promise<void> {
  await writeFile(
    join(planningDir, 'ROADMAP.md'),
    [
      '# Roadmap',
      '',
      '## Phase 1: Setup',
      'Goal: bootstrap the project',
      '',
      '| REQ | Phase |',
      '|-----|-------|',
      '| REQ-01 | 1 |',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(planningDir, 'REQUIREMENTS.md'),
    '# Requirements\n\n- REQ-01: bootstrap\n',
    'utf8',
  );
  await writeFile(
    join(planningDir, 'STATE.md'),
    '# State\n\n**Project:** demo\n\n## Current Phase\nPhase: 1 of 1\nStatus: ready\n\n## Todos\n- foo\n\n## Key Decisions\n_(no decisions)_\n\n## Blockers\n_(none)_\n',
    'utf8',
  );
  const phaseDir = join(planningDir, 'phases', '01-setup');
  await writeFile(
    join(phaseDir, '01-01-PLAN.md'),
    '---\nphase: "01"\nplan: "01"\n---\n# p\n',
    'utf8',
  );
  await writeFile(
    join(phaseDir, '01-01-SUMMARY.md'),
    '---\nphase: "01"\nplan: "01"\nstatus: complete\n---\n# s\n',
    'utf8',
  );
  await writeFile(
    join(phaseDir, '01-VERIFICATION.md'),
    '---\nphase: "01"\nresult: PASS\n---\n# v\n',
    'utf8',
  );
  await writeFile(
    join(phaseDir, '01-UAT.md'),
    '---\nphase: "01"\nstatus: complete\nissues: 0\n---\n# u\n',
    'utf8',
  );
}

describe('archiveHandler', () => {
  it('blocks when an active UAT has unresolved issues (UAT gate)', async () => {
    await seedHappyPath();
    await writeFile(
      join(planningDir, 'phases', '01-setup', '01-UAT.md'),
      '---\nphase: "01"\nstatus: issues_found\nissues: 2\n---\n',
      'utf8',
    );
    const handler = archiveHandler();
    const { io, stderr } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(2);
    expect(stderr.text()).toContain('UAT gate');
  });

  it('blocks when STATE.md phase_count drifts (state gate)', async () => {
    await seedHappyPath();
    await writeFile(
      join(planningDir, 'STATE.md'),
      '# State\n\n## Current Phase\nPhase: 1 of 7\n',
      'utf8',
    );
    const handler = archiveHandler();
    const { io, stderr } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(2);
    expect(stderr.text()).toContain('State consistency');
  });

  it('blocks when audit fails (e.g. roadmap goal TBD) without --force', async () => {
    await seedHappyPath();
    await writeFile(
      join(planningDir, 'ROADMAP.md'),
      '# Roadmap\n\n## Phase 1: Setup\nGoal: TBD\n',
      'utf8',
    );
    const handler = archiveHandler();
    const { io, stderr } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(1);
    expect(stderr.text()).toContain('audit failed');
  });

  it('archives the milestone end-to-end on a clean tree', async () => {
    await seedHappyPath();
    const handler = archiveHandler({
      today: () => '2026-05-06',
      resolveSlug: async () => '01-setup',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('Archive — 01-setup');

    const milestoneDir = join(planningDir, 'milestones', '01-setup');
    await stat(milestoneDir); // throws if missing
    await stat(join(milestoneDir, 'phases', '01-setup'));
    await stat(join(milestoneDir, 'ROADMAP.md'));
    await stat(join(milestoneDir, 'STATE.md'));
    await stat(join(milestoneDir, 'SHIPPED.md'));

    // Active phases dir should be empty.
    await expect(stat(join(planningDir, 'phases', '01-setup'))).rejects.toThrow();

    // Project STATE.md preserved at root with project-level sections.
    const rootState = await readFile(join(planningDir, 'STATE.md'), 'utf8');
    expect(rootState).toContain('foo'); // todo
  });
});
