import type { CommandRegistry } from '@swt-labs/shared';
import type { Hono } from 'hono';

import { COMMAND_REGISTRY_ENTRIES } from '../lib/command-registry-mirror.js';

/**
 * Registers `GET /api/commands`. Returns the full hand-mirrored CLI verb
 * registry so the dashboard's cmd-K palette (Phase 3 of v2.3) can list
 * every known verb with its `category` and `dashboard_safe` flag.
 *
 * The mirror's `dashboard_safe` flag matches the existing
 * `ALLOWED_NON_INTERACTIVE_VERBS` set in `lib/allowed-verbs.ts` — verbs
 * that the existing `POST /api/command` route can spawn cleanly. The
 * palette uses this flag to default-hide stubs + interactive verbs while
 * still listing them when the user explicitly toggles "show all".
 */
export function registerCommandsRoute(app: Hono): void {
  app.get('/api/commands', (c) => {
    const response: CommandRegistry = {
      verbs: [...COMMAND_REGISTRY_ENTRIES],
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });
}
