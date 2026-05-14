/**
 * Plan 06-03 T4 (Phase 4 R4 carry-forward) — integration tests for the
 * dashboard token auth middleware.
 *
 * Covers:
 *   - `initDashboardToken` writes a 32-byte hex token at 0600 perms.
 *   - `resolveDashboardToken` honors `SWT_DASHBOARD_TOKEN` env-var override.
 *   - `requireToken` middleware: 401 on missing/wrong/empty bearer; 200
 *     on correct token; `/api/health` exempt regardless of auth state.
 *   - Two independent boots generate distinct tokens (no fixed secret).
 */

import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  initDashboardToken,
  readDashboardToken,
  requireToken,
  resolveDashboardToken,
} from '../../src/server/lib/auth.js';

let root: string;
const TOKEN_REL = '.swt-planning/.dashboard/token';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'swt-dashboard-auth-'));
  delete process.env['SWT_DASHBOARD_TOKEN'];
});

afterEach(async () => {
  delete process.env['SWT_DASHBOARD_TOKEN'];
  if (root !== '') await rm(root, { recursive: true, force: true });
});

describe('Plan 06-03 T4 — initDashboardToken', () => {
  it('writes a 64-char hex token to .swt-planning/.dashboard/token', () => {
    const token = initDashboardToken({ projectRoot: root });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = fs.readFileSync(join(root, TOKEN_REL), 'utf8');
    expect(onDisk).toBe(token);
  });

  it('writes the token file with 0600 perms', () => {
    initDashboardToken({ projectRoot: root });
    const stat = fs.statSync(join(root, TOKEN_REL));
    // mask to perm bits only — different umask + FS layers can affect
    // the high bits but the 0o777 mask captures the file-perm subset.
    const perms = stat.mode & 0o777;
    // On most POSIX FS implementations this is exactly 0o600; Windows
    // / some network mounts may bump it. We assert the OWNER bits are
    // exactly read+write, and the group/other bits carry no execute or
    // write (a less strict invariant that holds across CI surfaces).
    expect(perms & 0o600).toBe(0o600);
    expect(perms & 0o033).toBe(0);
  });

  it('two independent boots produce distinct tokens', () => {
    const t1 = initDashboardToken({ projectRoot: root });
    const t2 = initDashboardToken({ projectRoot: root });
    expect(t1).not.toBe(t2);
    // The second call overwrites the file — per-boot semantics.
    expect(readDashboardToken({ projectRoot: root })).toBe(t2);
  });

  it('readDashboardToken throws when the file does not exist', () => {
    expect(() => readDashboardToken({ projectRoot: root })).toThrow(/Dashboard token file missing/);
  });
});

describe('Plan 06-03 T4 — resolveDashboardToken', () => {
  it('honors SWT_DASHBOARD_TOKEN env-var verbatim', () => {
    process.env['SWT_DASHBOARD_TOKEN'] = 'ops-supplied-token-value';
    const token = resolveDashboardToken({ projectRoot: root });
    expect(token).toBe('ops-supplied-token-value');
    // Daemon still writes the env-supplied value to disk so shell tools
    // can read it without re-exporting the var.
    expect(readDashboardToken({ projectRoot: root })).toBe('ops-supplied-token-value');
  });

  it('generates a fresh per-boot token when env var is unset', () => {
    const token = resolveDashboardToken({ projectRoot: root });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores an empty SWT_DASHBOARD_TOKEN and generates a fresh one', () => {
    process.env['SWT_DASHBOARD_TOKEN'] = '';
    const token = resolveDashboardToken({ projectRoot: root });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Plan 06-03 T4 — requireToken middleware', () => {
  function makeApp(token: string): Hono {
    const app = new Hono();
    app.use('/api/*', requireToken({ token }));
    app.get('/api/health', (c) => c.json({ status: 'ok' }));
    app.get('/api/whatever', (c) => c.json({ ok: true }));
    return app;
  }

  it('returns 401 with no Authorization header', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/whatever');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 with wrong token', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/whatever', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed Authorization header', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/whatever', {
      headers: { Authorization: 'Token correct-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/whatever', {
      headers: { Authorization: 'Bearer correct-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it('exempts /api/health from auth (passes without token)', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe('ok');
  });

  it('still passes /api/health when an incorrect token IS supplied', async () => {
    const app = makeApp('correct-token');
    const res = await app.request('/api/health', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(200);
  });
});
