import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DetectPhaseReportSchema } from '@swt-labs/dashboard-core';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDetectPhaseRoute } from '../src/server/routes/detect-phase.ts';

let cwd: string;
let app: Hono;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-detect-phase-route-'));
  app = new Hono();
  registerDetectPhaseRoute(app, cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  app = new Hono();
});

function writeFile(path: string, content: string): void {
  const full = join(cwd, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

async function getDetectPhase(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/detect-phase', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/detect-phase', () => {
  it('returns is_initialized:false for a greenfield directory (no .swt-planning/)', async () => {
    const { status, body } = await getDetectPhase();
    expect(status).toBe(200);
    const report = DetectPhaseReportSchema.parse(body);
    expect(report.is_initialized).toBe(false);
    const r = report.result as { planning_dir_exists: boolean; project_exists: boolean };
    expect(r.planning_dir_exists).toBe(false);
    expect(r.project_exists).toBe(false);
  });

  it('returns is_initialized:true once PROJECT.md exists in .swt-planning/', async () => {
    writeFile(
      '.swt-planning/PROJECT.md',
      '# my-project\n\nSeeded for the detect-phase route test.\n',
    );
    const { status, body } = await getDetectPhase();
    expect(status).toBe(200);
    const report = DetectPhaseReportSchema.parse(body);
    expect(report.is_initialized).toBe(true);
    const r = report.result as { planning_dir_exists: boolean; project_exists: boolean };
    expect(r.planning_dir_exists).toBe(true);
    expect(r.project_exists).toBe(true);
  });

  it('reports phase_count_zero when project exists but no phases dir', async () => {
    writeFile('.swt-planning/PROJECT.md', '# my-project\n');
    const { body } = await getDetectPhase();
    const report = DetectPhaseReportSchema.parse(body);
    const r = report.result as { phase_count: number; next_phase_state: string };
    expect(r.phase_count).toBe(0);
    expect(r.next_phase_state).toBe('phase_count_zero');
  });

  it('reports needs_plan_and_execute when a phase dir exists with no PLAN.md', async () => {
    writeFile('.swt-planning/PROJECT.md', '# my-project\n');
    writeFile(
      '.swt-planning/ROADMAP.md',
      '# Roadmap\n\n## Phase 01 — Setup\n\n**Goal:** Stand up the test fixture phase.\n',
    );
    mkdirSync(join(cwd, '.swt-planning', 'phases', '01-setup'), { recursive: true });
    const { body } = await getDetectPhase();
    const report = DetectPhaseReportSchema.parse(body);
    const r = report.result as { phase_count: number; next_phase_state: string };
    expect(r.phase_count).toBe(1);
    expect(r.next_phase_state).toBe('needs_plan_and_execute');
  });

  it('emits a generated_at ISO-8601 timestamp on every response', async () => {
    const { body } = await getDetectPhase();
    const report = DetectPhaseReportSchema.parse(body);
    const t = new Date(report.generated_at).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('payload validates against DetectPhaseReportSchema (smoke contract test)', async () => {
    const { body } = await getDetectPhase();
    expect(() => DetectPhaseReportSchema.parse(body)).not.toThrow();
  });
});
