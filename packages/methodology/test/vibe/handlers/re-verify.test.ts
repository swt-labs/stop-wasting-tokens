import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reVerifyHandler } from '../../../src/vibe/handlers/re-verify.js';
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
  kind: 're-verify',
  phase: '01',
  phase_slug: '01-setup',
  requires_confirmation: false,
};

let cwd: string;
let phaseDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-reverify-handler-'));
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

describe('reVerifyHandler', () => {
  it('archives an existing UAT.md into round-01 and bumps remediation round', async () => {
    await writeFile(join(phaseDir, '01-UAT.md'), '---\nphase: "01"\n---\n# old\n', 'utf8');
    const handler = reVerifyHandler();
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);

    const archived = join(phaseDir, 'remediation', 'uat', 'round-01', 'R01-UAT.md');
    const archivedStat = await stat(archived);
    expect(archivedStat.isFile()).toBe(true);
    await expect(stat(join(phaseDir, '01-UAT.md'))).rejects.toThrow();

    expect(stdout.text()).toContain('round-01');
    expect(stdout.text()).toContain('round to 02');

    const stateRaw = await readFile(join(phaseDir, '.uat-remediation-stage'), 'utf8');
    const state = JSON.parse(stateRaw);
    expect(state.round).toBe(2);
  });

  it('is a no-op when no prior UAT exists', async () => {
    const handler = reVerifyHandler();
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('no prior UAT to archive');

    const state = JSON.parse(await readFile(join(phaseDir, '.uat-remediation-stage'), 'utf8'));
    expect(state.round).toBe(1);
  });

  it('surfaces the cap banner and does not bump round when cap is reached', async () => {
    // Bump remediation state to round 3, then enforce a max of 3.
    await writeFile(
      join(phaseDir, '.uat-remediation-stage'),
      JSON.stringify(
        {
          version: 1,
          round: 3,
          layout: 'round-dir',
          severity: 'major',
          started: '2026-05-06T00:00:00.000Z',
          last_stage: 'none',
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(join(phaseDir, '01-UAT.md'), '---\nphase: "01"\n---\n# u\n', 'utf8');

    const handler = reVerifyHandler({
      resolveMaxRounds: async () => 3,
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('Reached maximum UAT remediation rounds (3)');
    // UAT.md not archived; round not bumped.
    const stillExists = await readFile(join(phaseDir, '01-UAT.md'), 'utf8');
    expect(stillExists).toContain('# u');
    const state = JSON.parse(await readFile(join(phaseDir, '.uat-remediation-stage'), 'utf8'));
    expect(state.round).toBe(3);
  });
});
