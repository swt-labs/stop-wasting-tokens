// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { AgentSpawner, AgentSpec, SpawnRequest, SpawnResult } from '@swt-labs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { qaHandler } from '../../../src/vibe/handlers/qa.js';
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

class QaSpawner implements AgentSpawner {
  public readonly seen: SpawnRequest[] = [];
  constructor(private readonly handoff: Record<string, unknown>) {}
  async installAgent(_spec: AgentSpec): Promise<void> {}
  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    this.seen.push(req);
    return {
      role: 'qa',
      success: true,
      handoff: this.handoff,
    };
  }
  async removeAgent(): Promise<void> {}
}

const qaSpec: AgentSpec = {
  role: 'qa',
  model: 'mock',
  reasoning_effort: 'balanced',
  developer_instructions: 'mock',
  allowed_mcp_servers: [],
};

const route: VibeRoute = {
  kind: 'qa-remediation',
  phase: '01',
  phase_slug: '01-setup',
  requires_confirmation: false,
};

let cwd: string;
let phaseDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-qa-handler-'));
  phaseDir = join(cwd, '.swt-planning', 'phases', '01-setup');
  await mkdir(phaseDir, { recursive: true });
  await writeFile(
    join(phaseDir, '01-01-SUMMARY.md'),
    '---\nphase: "01"\nplan: "01"\nstatus: complete\ntasks_completed: 1\ntasks_total: 1\n---\n# x\n',
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

describe.skip('qaHandler', () => {
  it('throws NotImplementedError when no spawner is supplied', async () => {
    const handler = qaHandler();
    const { io } = makeIO();
    await expect(handler.run(route, io)).rejects.toThrow(/AgentSpawner/);
  });

  it('writes VERIFICATION.md and updates known-issues from a QA handoff', async () => {
    const handoff = {
      from: 'qa',
      to: 'orchestrator',
      kind: 'qa-verification',
      payload: {
        phase: '01',
        plans_verified: ['01'],
        result: 'partial',
        checks: [
          { id: 'AC1', must_have: 'README present', status: 'pass', evidence: 'README.md' },
          { id: 'AC2', must_have: 'LICENSE present', status: 'fail', evidence: 'missing' },
        ],
        pre_existing_issues: [],
      },
      metadata: { created_at: '2026-05-06T00:00:00.000Z' },
    };
    const handler = qaHandler({
      spawner: new QaSpawner(handoff),
      qaSpec,
      resolveHeadCommit: async () => 'deadbeef00112233',
      today: () => '2026-05-06',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('01-VERIFICATION.md');

    const verification = await readFile(join(phaseDir, '01-VERIFICATION.md'), 'utf8');
    expect(verification).toContain('verified_at_commit: "deadbeef00112233"');
    expect(verification).toContain('result: "PARTIAL"');
    expect(verification).toContain('AC2 | LICENSE present | FAIL');

    const known = JSON.parse(await readFile(join(phaseDir, 'known-issues.json'), 'utf8'));
    expect(known.issues).toHaveLength(1);
    expect(known.issues[0].id).toBe('KI-01-AC2');
    expect(known.issues[0].status).toBe('open');
  });

  it('returns exit=1 when QA result is fail', async () => {
    const handoff = {
      from: 'qa',
      to: 'orchestrator',
      kind: 'qa-verification',
      payload: {
        phase: '01',
        plans_verified: ['01'],
        result: 'fail',
        checks: [{ id: 'AC1', must_have: 'all good', status: 'fail', evidence: 'broken' }],
        pre_existing_issues: [],
      },
      metadata: { created_at: '2026-05-06T00:00:00.000Z' },
    };
    const handler = qaHandler({
      spawner: new QaSpawner(handoff),
      qaSpec,
      resolveHeadCommit: async () => 'cafe',
      today: () => '2026-05-06',
    });
    const { io } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(1);
  });
});
