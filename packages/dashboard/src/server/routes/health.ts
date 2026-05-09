import type { Hono } from 'hono';

import type { HealthResponse } from '@swt-labs/dashboard-core';

export function registerHealthRoute(app: Hono, startedAt: number): void {
  app.get('/api/health', (c) => {
    const response: HealthResponse = {
      status: 'ok',
      uptime_ms: Date.now() - startedAt,
      schema_version: '1',
    };
    return c.json(response);
  });
}
