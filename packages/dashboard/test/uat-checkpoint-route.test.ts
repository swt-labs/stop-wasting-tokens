import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerUatCheckpointRoute } from '../src/server/routes/uat-checkpoint.ts';

let projectRoot: string;
let app: Hono;

function setupPhaseDir(slug: string, withUat = true): string {
  const phaseDir = path.join(projectRoot, '.swt-planning', 'phases', slug);
  mkdirSync(phaseDir, { recursive: true });
  if (withUat) {
    const position = slug.slice(0, 2);
    const uatPath = path.join(phaseDir, `${position}-UAT.md`);
    writeFileSync(
      uatPath,
      `# Phase ${position} UAT\n\n## CHECKPOINTs\n\n### P${position}-T01: existing\n\n- **Result:** pass\n`,
      'utf8',
    );
  }
  return phaseDir;
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-uat-route-'));
  app = new Hono();
  registerUatCheckpointRoute(app, projectRoot);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('POST /api/uat/:phase/checkpoint', () => {
  it('appends a CHECKPOINT block and returns saved=true', async () => {
    const phaseDir = setupPhaseDir('03-live-event-stream');
    const res = await app.request('/api/uat/03/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'AC-04 reconnect under network drop',
        result: 'pass',
        note: 'kill -STOP daemon for 6s, page reconnected at 8s mark',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { saved: boolean; path: string };
    expect(json.saved).toBe(true);
    expect(json.path).toContain('03-UAT.md');

    const written = readFileSync(path.join(phaseDir, '03-UAT.md'), 'utf8');
    expect(written).toMatch(/### P03-T02: AC-04 reconnect under network drop/);
    expect(written).toMatch(/\*\*Result:\*\* pass/);
    expect(written).toMatch(/\*\*Notes:\*\* kill -STOP daemon for 6s/);
  });

  it('returns 400 for an invalid body', async () => {
    setupPhaseDir('03-live');
    const res = await app.request('/api/uat/03/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: '', result: 'maybe' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_body');
  });

  it('returns 404 when the phase does not exist', async () => {
    const res = await app.request('/api/uat/99/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'whatever', result: 'pass' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the phase has no UAT artifact yet', async () => {
    setupPhaseDir('03-live-event-stream', false);
    const res = await app.request('/api/uat/03/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'too early',
        result: 'pass',
      }),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('uat_artifact_missing');
    expect(
      existsSync(
        path.join(projectRoot, '.swt-planning', 'phases', '03-live-event-stream', '03-UAT.md'),
      ),
    ).toBe(false);
  });
});
