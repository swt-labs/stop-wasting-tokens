/**
 * GET /api/models — flat list of every model Pi's `ModelRegistry` knows
 * about, so the dashboard TopBar Model dropdown can render an authoritative
 * per-provider list without mirroring Pi's registry locally.
 *
 * Pi exposes `ModelRegistry.inMemory(authStorage).getAll(): Model[]` —
 * each entry has the shape we need (id, provider, name, contextWindow,
 * reasoning) plus a bunch we trim out (api, baseUrl, cost, headers,
 * thinkingLevelMap, compat). We construct a transient registry per
 * request (cheap — Pi's registry is essentially a typed wrapper over a
 * static list of providers) and project each Model into ModelInfo for
 * the wire.
 *
 * Why per-request: alpha.35 keeps it simple. The model list is effectively
 * static (changes only when the user edits `.swt-planning/config.json`'s
 * provider config block, which is rare); caching can land in a future
 * pass if the registry-construction cost shows up under load.
 *
 * No secrets: the response is provider+model metadata only — no API
 * keys, no auth status, no usage. Mirrors the secret-free contract of
 * `/api/provider-auth` (which IS secret-aware but redacts).
 */

import { listAllModels } from '@swt-labs/runtime';
import { ModelsSnapshotSchema } from '@swt-labs/shared';
import type { Hono } from 'hono';

export function registerModelsRoute(app: Hono): void {
  app.get('/api/models', async (c) => {
    try {
      // Pi-side model enumeration lives in @swt-labs/runtime (Principle 1:
      // only runtime value-level-imports pi-coding-agent). The helper
      // returns an array of `{ id, provider, name, contextWindow,
      // reasoning }` projected from Pi's ModelRegistry.getAll().
      const models = listAllModels();
      const snapshot = ModelsSnapshotSchema.parse({
        models,
        generated_at: new Date().toISOString(),
      });
      return c.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'models_list_failed', detail: message }, 500);
    }
  });
}
