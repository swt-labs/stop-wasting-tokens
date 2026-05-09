import type { HealthResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

export function registerHealthRoute(app: Hono, startedAt: number): void {
  app.get('/api/health', (c) => {
    // B-15 / S-04: report the daemon's SWT version for `/api/health` clients
    // (notably the CLI's `swt doctor` and any future health dashboards). The
    // CLI sets SWT_DASHBOARD_DAEMON_VERSION when spawning; if absent (e.g.,
    // direct daemon invocation in dev), the field is omitted rather than
    // hardcoded — clients are expected to handle the optional field.
    const daemonVersion = process.env['SWT_DASHBOARD_DAEMON_VERSION'];
    const response: HealthResponse = {
      status: 'ok',
      uptime_ms: Date.now() - startedAt,
      schema_version: '1',
      ...(daemonVersion !== undefined && daemonVersion.length > 0
        ? { daemon_version: daemonVersion }
        : {}),
    };
    return c.json(response);
  });
}
