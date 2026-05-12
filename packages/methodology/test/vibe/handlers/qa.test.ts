import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { AgentSpawner, AgentSpec, SpawnRequest, SpawnResult } from '@swt-labs/core';
import type { StaticCheck, StaticCheckResult } from '@swt-labs/verification';
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
  thinking_level: 'medium',
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

function makeIO(): {
  io: { cwd: string; stdout: StringStream; stderr: StringStream };
  stdout: StringStream;
  stderr: StringStream;
} {
  const stdout = new StringStream();
  const stderr = new StringStream();
  return { io: { cwd, stdout, stderr }, stdout, stderr };
}

function passingCheck(name: string): StaticCheck {
  return {
    name,
    async run(): Promise<StaticCheckResult> {
      return { name, status: 'passed', exitCode: 0, durationMs: 1, outputTail: `${name} ok` };
    },
  };
}

function failingCheck(name: string): StaticCheck {
  return {
    name,
    async run(): Promise<StaticCheckResult> {
      return { name, status: 'failed', exitCode: 1, durationMs: 1, outputTail: `${name} broke` };
    },
  };
}

const ALL_PASS: ReadonlyArray<StaticCheck> = [
  passingCheck('typecheck'),
  passingCheck('lint'),
  passingCheck('format'),
  passingCheck('tests'),
];

describe('qaHandler', () => {
  it('runs the static-check ladder with NO spawner — writes a pass VERIFICATION.md when all checks pass', async () => {
    const handler = qaHandler({
      checks: ALL_PASS,
      resolveHeadCommit: async () => 'deadbeef00112233',
      today: () => '2026-05-06',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(0);
    expect(stdout.text()).toContain('static-check ladder passed');
    const verification = await readFile(join(phaseDir, '01-VERIFICATION.md'), 'utf8');
    expect(verification).toContain('result: "PASS"');
    expect(verification).toContain('STATIC-TYPECHECK');
  });

  it('writes a failed VERIFICATION.md when the static-check ladder fails — and skips the must-haves dispatch', async () => {
    const spawner = new QaSpawner({});
    const handler = qaHandler({
      checks: [passingCheck('typecheck'), failingCheck('lint')],
      spawner,
      qaSpec,
      resolveHeadCommit: async () => 'cafe',
      today: () => '2026-05-06',
    });
    const { io, stdout } = makeIO();
    const result = await handler.run(route, io);
    expect(result.exit).toBe(1);
    expect(stdout.text()).toContain('static-check ladder failed at lint');
    expect(spawner.seen).toHaveLength(0); // must-haves dispatch NOT called
    const verification = await readFile(join(phaseDir, '01-VERIFICATION.md'), 'utf8');
    expect(verification).toContain('result: "FAIL"');
    expect(verification).toContain('STATIC-CHECK');
    expect(verification).toContain('lint failed');
  });

  it('writes VERIFICATION.md and updates known-issues from a QA handoff (ladder passes, agent verifies must-haves)', async () => {
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
      checks: ALL_PASS,
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

  it('returns exit=1 when QA result is fail (after ladder passes)', async () => {
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
      checks: ALL_PASS,
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
