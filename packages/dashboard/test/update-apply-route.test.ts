import { UpdateApplyResponseSchema } from '@swt-labs/dashboard-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  registerUpdateRoute,
  type ApplySpawnFn,
  type ApplySpawnLike,
} from '../src/server/routes/update.ts';

let app: Hono;

function buildApp(spawnFn: ApplySpawnFn): Hono {
  app = new Hono();
  registerUpdateRoute(app, {
    fetchImpl: (async () =>
      new Response(JSON.stringify({ version: '0.0.0-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    spawnFn,
    currentVersion: '0.0.0-test',
    applyTimeoutMs: 1000,
  });
  return app;
}

beforeEach(() => {
  app = new Hono();
});

async function postApply(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/update/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
}

function makeSpawn(result: ApplySpawnLike): ApplySpawnFn {
  return (): Promise<ApplySpawnLike> => Promise.resolve(result);
}

describe('POST /api/update/apply', () => {
  it('returns ok:true when npm install exits 0', async () => {
    buildApp(
      makeSpawn({
        status: 0,
        signal: null,
        stdout: 'added 1 package in 3s\n',
        stderr: '',
      }),
    );
    const { status, body } = await postApply();
    expect(status).toBe(200);
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    expect(parsed.exit_code).toBe(0);
    expect(parsed.requires_elevation).toBe(false);
    expect(parsed.copyable_command).toBeNull();
    expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('detects EACCES via child.error.code and returns the copyable sudo command', async () => {
    const eaccesErr = Object.assign(new Error('spawn npm EACCES'), { code: 'EACCES' });
    buildApp(
      makeSpawn({
        status: null,
        signal: null,
        error: eaccesErr,
        stdout: '',
        stderr: '',
      }),
    );
    const { body } = await postApply();
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.requires_elevation).toBe(true);
    expect(parsed.copyable_command).toMatch(/sudo npm install -g stop-wasting-tokens@latest/);
  });

  it('detects EPERM via stderr regex and returns the copyable sudo command', async () => {
    buildApp(
      makeSpawn({
        status: 1,
        signal: null,
        stdout: '',
        stderr:
          'npm error code EPERM\nnpm error syscall mkdir\nnpm error path /usr/local/lib/node_modules/.stop-wasting-tokens\n',
      }),
    );
    const { body } = await postApply();
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.requires_elevation).toBe(true);
    expect(parsed.copyable_command).toMatch(/sudo/);
  });

  it('passes through non-elevation failures (network / npm error) without setting copyable_command', async () => {
    buildApp(
      makeSpawn({
        status: 1,
        signal: null,
        stdout: '',
        stderr:
          'npm error code ENETUNREACH\nnpm error errno ENETUNREACH\nnpm error network connect ECONNREFUSED\n',
      }),
    );
    const { body } = await postApply();
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.requires_elevation).toBe(false);
    expect(parsed.copyable_command).toBeNull();
    expect(parsed.stderr).toMatch(/ENETUNREACH/);
  });

  it('handles spawn timeout (SIGTERM) — returns ok:false with stderr noting the kill', async () => {
    buildApp(
      makeSpawn({
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '\n[dashboard] npm exceeded 1000ms; killed.\n',
      }),
    );
    const { body } = await postApply();
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.exit_code).toBe(-1);
    expect(parsed.stderr).toMatch(/exceeded 1000ms; killed/);
  });

  it('preserves stderr verbatim so the panel can show npm output to the user', async () => {
    const stderr = 'npm warn deprecated something@1.0.0\nnpm error specific failure detail\n';
    buildApp(
      makeSpawn({
        status: 1,
        signal: null,
        stdout: '',
        stderr,
      }),
    );
    const { body } = await postApply();
    const parsed = UpdateApplyResponseSchema.parse(body);
    expect(parsed.stderr).toContain('npm error specific failure detail');
  });
});
