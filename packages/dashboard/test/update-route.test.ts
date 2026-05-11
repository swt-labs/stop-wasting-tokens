import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UpdateReportSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerUpdateRoute } from '../src/server/routes/update.ts';

let cacheDir: string;
let cachePath: string;
let app: Hono;

function freshAppWithFetch(fetchImpl: typeof fetch, currentVersion: string): Hono {
  app = new Hono();
  registerUpdateRoute(app, {
    fetchImpl,
    cachePath,
    currentVersion,
    noCache: true, // every test exercises the live fetch path; no cache reuse.
  });
  return app;
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'swt-update-route-'));
  cachePath = join(cacheDir, 'update-cache.json');
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

async function getUpdate(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/update', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

function buildFetchOk(version: string): typeof fetch {
  return async () => {
    return new Response(JSON.stringify({ version }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function buildFetchHttpStatus(httpStatus: number): typeof fetch {
  return async () => {
    return new Response('', { status: httpStatus });
  };
}

function buildFetchThrows(message: string): typeof fetch {
  return async () => {
    throw new Error(message);
  };
}

describe('GET /api/update', () => {
  it('returns up-to-date with update_available:false when registry version matches current', async () => {
    freshAppWithFetch(buildFetchOk('2.3.0'), '2.3.0');
    const { status, body } = await getUpdate();
    expect(status).toBe(200);
    const report = UpdateReportSchema.parse(body);
    expect(report.current_version).toBe('2.3.0');
    expect(report.latest_version).toBe('2.3.0');
    expect(report.update_available).toBe(false);
    expect(report.error).toBeNull();
    expect(report.registry).toBe('npm');
  });

  it('returns outdated with update_available:true when registry has a newer version', async () => {
    freshAppWithFetch(buildFetchOk('2.4.0'), '2.3.0');
    const { body } = await getUpdate();
    const report = UpdateReportSchema.parse(body);
    expect(report.current_version).toBe('2.3.0');
    expect(report.latest_version).toBe('2.4.0');
    expect(report.update_available).toBe(true);
    expect(report.error).toBeNull();
  });

  it('returns latest_version:null + error message when registry is unreachable (fetch throws)', async () => {
    freshAppWithFetch(buildFetchThrows('ENOTFOUND registry.npmjs.org'), '2.3.0');
    const { body } = await getUpdate();
    const report = UpdateReportSchema.parse(body);
    expect(report.current_version).toBe('2.3.0');
    expect(report.latest_version).toBeNull();
    expect(report.update_available).toBe(false);
    expect(report.error).toMatch(/ENOTFOUND/);
  });

  it('returns latest_version:null + HTTP error when registry replies non-2xx', async () => {
    freshAppWithFetch(buildFetchHttpStatus(503), '2.3.0');
    const { body } = await getUpdate();
    const report = UpdateReportSchema.parse(body);
    expect(report.latest_version).toBeNull();
    expect(report.update_available).toBe(false);
    expect(report.error).toMatch(/HTTP 503/);
  });

  it('honors the currentVersion option (test seam for build-time-substituted CLI version)', async () => {
    freshAppWithFetch(buildFetchOk('1.2.3'), '1.2.3');
    const { body } = await getUpdate();
    const report = UpdateReportSchema.parse(body);
    expect(report.current_version).toBe('1.2.3');
    expect(report.latest_version).toBe('1.2.3');
  });

  it('emits a generated_at ISO-8601 timestamp on every response', async () => {
    freshAppWithFetch(buildFetchOk('2.3.0'), '2.3.0');
    const { body } = await getUpdate();
    const report = UpdateReportSchema.parse(body);
    const t = new Date(report.last_checked).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });
});
