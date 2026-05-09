import { AlreadyInitializedError, initProject } from '@swt-labs/core';
import { InitBodySchema, type InitResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const PLANNING_DIR = '.swt-planning';

export function registerInitRoute(
  app: Hono,
  cwd: string,
  onInitialized: (root: string) => void,
): void {
  app.post('/api/init', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = InitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    try {
      const result = initProject({
        cwd,
        name: parsed.data.name,
        description: parsed.data.description,
        source: 'dashboard',
      });
      onInitialized(result.root);
      const response: InitResponse = {
        initialized: true,
        root: result.root,
        files: [...result.files],
      };
      return c.json(response);
    } catch (err: unknown) {
      if (err instanceof AlreadyInitializedError) {
        return c.json(
          { error: 'already_initialized', detail: `${PLANNING_DIR}/ already exists at ${cwd}` },
          409,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'init_failed', detail: message }, 500);
    }
  });
}
