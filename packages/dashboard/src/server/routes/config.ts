import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_CONFIG, parseConfig } from '@swt-labs/core';
import type { ConfigSnapshot } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const PLANNING_DIR = '.swt-planning';
const CONFIG_FILENAME = 'config.json';

/**
 * Registers `GET /api/config`. Mirrors the CLI's `swt config show` data
 * access: read `{cwd}/.swt-planning/config.json`, fall back to
 * `DEFAULT_CONFIG` on ENOENT (greenfield), run through `parseConfig` so
 * the dashboard sees the same canonical shape the CLI does.
 *
 * Greenfield daemons (no `.swt-planning/`) intentionally return 200 with
 * `is_initialized: false` so the SPA can render the panel as a "what your
 * config WOULD look like" preview rather than blanking it out.
 *
 * Hard parse / validation failures return 500 — `.swt-planning/config.json`
 * being unreadable JSON or schema-invalid is a real problem the user
 * needs to see, not a state the dashboard should silently paper over.
 */
export function registerConfigRoute(app: Hono, cwd: string): void {
  const cfgPath = join(cwd, PLANNING_DIR, CONFIG_FILENAME);
  app.get('/api/config', async (c) => {
    let raw: string;
    try {
      raw = await readFile(cfgPath, 'utf8');
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'ENOENT'
      ) {
        const response: ConfigSnapshot = {
          is_initialized: false,
          config: DEFAULT_CONFIG,
          source: 'default',
          generated_at: new Date().toISOString(),
        };
        return c.json(response);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'config_read_failed', detail: message }, 500);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return c.json({ error: 'invalid_config_json', detail: message }, 500);
    }
    let validated;
    try {
      validated = parseConfig(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'invalid_config_schema', detail: message }, 500);
    }
    const response: ConfigSnapshot = {
      is_initialized: true,
      config: validated,
      source: 'file',
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });
}
