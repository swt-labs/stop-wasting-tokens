// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { HealthResponseSchema } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServer, type DashboardServer } from '../src/server/index.js';

describe.skip('dashboard server', () => {
  let server: DashboardServer | undefined;

  beforeEach(async () => {
    server = await createServer({ port: 0 });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('boots and binds to 127.0.0.1 on an OS-assigned port', () => {
    expect(server).toBeDefined();
    expect(server?.hostname).toBe('127.0.0.1');
    expect(server?.port).toBeGreaterThan(0);
  });

  it('GET /api/health returns the validated HealthResponse shape', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`http://${server.hostname}:${server.port}/api/health`);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = HealthResponseSchema.parse(json);
    expect(parsed.status).toBe('ok');
    expect(parsed.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(parsed.schema_version).toBe('1');
  });

  it('refuses 0.0.0.0 without allowPublic', async () => {
    await expect(createServer({ port: 0, hostname: '0.0.0.0' })).rejects.toThrow(/refuses to bind/);
  });

  it('accepts 0.0.0.0 when allowPublic=true', async () => {
    const wide = await createServer({ port: 0, hostname: '0.0.0.0', allowPublic: true });
    try {
      expect(wide.hostname).toBe('0.0.0.0');
      expect(wide.port).toBeGreaterThan(0);
    } finally {
      await wide.close();
    }
  });
});
