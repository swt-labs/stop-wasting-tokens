import { AlreadyInitializedError, initProject } from '@swt-labs/core';
import { InitBodySchema, type InitResponse, type Snapshot } from '@swt-labs/shared';
import type { Hono } from 'hono';

const PLANNING_DIR = '.swt-planning';

export function registerInitRoute(
  app: Hono,
  cwd: string,
  onInitialized: (root: string) => void,
  /**
   * Resolves the just-spun-up snapshotter's current state after onInitialized
   * has run. Returns null if no snapshotter was attached (e.g., onInitialized
   * was a no-op because someone else got there first). The route includes the
   * snapshot inline in the response so clients can skip a follow-up
   * GET /api/snapshot round-trip (B-08 / S-02).
   */
  getSnapshot: () => Snapshot | null = () => null,
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
      const snapshot = getSnapshot();
      const response: InitResponse = {
        initialized: true,
        root: result.root,
        files: [...result.files],
        ...(snapshot !== null ? { snapshot } : {}),
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
