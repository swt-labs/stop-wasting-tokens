import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DoctorReportSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CodexVersion } from '../src/server/lib/detect-codex.ts';
import { registerDoctorRoute, type DoctorDeps } from '../src/server/routes/doctor.ts';

let cwd: string;
let app: Hono;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-doctor-route-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function buildApp(deps: DoctorDeps): Hono {
  app = new Hono();
  registerDoctorRoute(app, cwd, deps);
  return app;
}

async function getDoctor(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/doctor', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

const FAKE_CODEX: CodexVersion = { version: '0.124.0', major: 0, minor: 124, patch: 0 };
const NEW_NODE = (): string => '22.0.0';
const OLD_NODE = (): string => '18.16.0';
const PRESENT_PLANNING = (): Promise<unknown> => Promise.resolve({});
const MISSING_PLANNING = (): Promise<unknown> => Promise.reject(new Error('ENOENT'));

describe('GET /api/doctor', () => {
  it('returns overall_status: pass when every check passes (Node ≥ 20, codex present, planning dir present)', async () => {
    buildApp({
      node: NEW_NODE,
      codex: () => Promise.resolve(FAKE_CODEX),
      stat: PRESENT_PLANNING,
    });
    const { status, body } = await getDoctor();
    expect(status).toBe(200);
    const report = DoctorReportSchema.parse(body);
    expect(report.overall_status).toBe('pass');
    expect(report.checks).toHaveLength(3);
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('warns on Node major < 20 (overall_status downgrades to warn)', async () => {
    buildApp({
      node: OLD_NODE,
      codex: () => Promise.resolve(FAKE_CODEX),
      stat: PRESENT_PLANNING,
    });
    const { body } = await getDoctor();
    const report = DoctorReportSchema.parse(body);
    expect(report.overall_status).toBe('warn');
    const node = report.checks.find((c) => c.id === 'node-version');
    expect(node?.status).toBe('warn');
    expect(node?.detail).toMatch(/requires Node 20/);
  });

  it('warns when Codex CLI is missing', async () => {
    buildApp({
      node: NEW_NODE,
      codex: () => Promise.resolve(undefined),
      stat: PRESENT_PLANNING,
    });
    const { body } = await getDoctor();
    const report = DoctorReportSchema.parse(body);
    expect(report.overall_status).toBe('warn');
    const codex = report.checks.find((c) => c.id === 'codex-cli');
    expect(codex?.status).toBe('warn');
    expect(codex?.detail).toMatch(/not found/i);
  });

  it('warns when .swt-planning/ is missing (greenfield)', async () => {
    buildApp({
      node: NEW_NODE,
      codex: () => Promise.resolve(FAKE_CODEX),
      stat: MISSING_PLANNING,
    });
    const { body } = await getDoctor();
    const report = DoctorReportSchema.parse(body);
    expect(report.overall_status).toBe('warn');
    const planning = report.checks.find((c) => c.id === 'planning-dir');
    expect(planning?.status).toBe('warn');
    expect(planning?.detail).toMatch(/swt init|InitScreen/i);
  });

  it('aggregates multiple warns into a single overall_status: warn', async () => {
    buildApp({
      node: OLD_NODE,
      codex: () => Promise.resolve(undefined),
      stat: MISSING_PLANNING,
    });
    const { body } = await getDoctor();
    const report = DoctorReportSchema.parse(body);
    expect(report.overall_status).toBe('warn');
    expect(report.checks.every((c) => c.status === 'warn')).toBe(true);
  });

  it('emits a generated_at ISO-8601 timestamp on every response', async () => {
    buildApp({
      node: NEW_NODE,
      codex: () => Promise.resolve(FAKE_CODEX),
      stat: PRESENT_PLANNING,
    });
    const { body } = await getDoctor();
    const report = DoctorReportSchema.parse(body);
    const t = new Date(report.generated_at).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });
});
