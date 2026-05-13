import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerCookControlRoute } from '../src/server/routes/cook-control.js';

/**
 * Plan 04-02 T3 — `POST /api/cook/:sessionId/control` writes the right
 * signal-file content (`pause` | `resume` | `cancel`) under
 * `.swt-planning/.cook-controls/{sessionId}.pending`, returns the dashboard's
 * intended `new_state`, and rejects malformed inputs with 400.
 */

function setup(): { app: Hono; projectRoot: string } {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-ctrl-'));
  const app = new Hono();
  registerCookControlRoute(app, { projectRoot });
  return { app, projectRoot };
}

function controlFile(projectRoot: string, sessionId: string): string {
  return path.join(projectRoot, '.swt-planning', '.cook-controls', `${sessionId}.pending`);
}

describe('POST /api/cook/:sessionId/control', () => {
  it('writes "pause" and returns new_state: paused', async () => {
    const { app, projectRoot } = setup();
    const sid = 'sess-aaa';
    const res = await app.request(`http://x/api/cook/${sid}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; new_state: string };
    expect(body).toEqual({ ok: true, new_state: 'paused' });
    expect(existsSync(controlFile(projectRoot, sid))).toBe(true);
    expect(readFileSync(controlFile(projectRoot, sid), 'utf8')).toBe('pause');
  });

  it('writes "resume" and returns new_state: running', async () => {
    const { app, projectRoot } = setup();
    const sid = 'sess-bbb';
    const res = await app.request(`http://x/api/cook/${sid}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { new_state: string };
    expect(body.new_state).toBe('running');
    expect(readFileSync(controlFile(projectRoot, sid), 'utf8')).toBe('resume');
  });

  it('writes "cancel" and returns new_state: cancelled', async () => {
    const { app, projectRoot } = setup();
    const sid = 'sess-ccc';
    const res = await app.request(`http://x/api/cook/${sid}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { new_state: string };
    expect(body.new_state).toBe('cancelled');
    expect(readFileSync(controlFile(projectRoot, sid), 'utf8')).toBe('cancel');
  });

  it('rejects unknown actions with 400', async () => {
    const { app } = setup();
    const res = await app.request('http://x/api/cook/sess/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'nuke' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid action/);
  });

  it('rejects sessionId containing path-traversal characters with 400', async () => {
    const { app } = setup();
    const res = await app.request('http://x/api/cook/..%2Fetc/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty/missing JSON body with 400', async () => {
    const { app } = setup();
    const res = await app.request('http://x/api/cook/sess/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
  });
});
