import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ConfigError, DEFAULT_CONFIG, parseConfig } from '@swt-labs/core';
import {
  ConfigUpdateBodySchema,
  type ConfigSnapshot,
  type ConfigUpdateResponse,
} from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

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
export function registerConfigRoute(app: Hono, cwd: string, bus?: EventBus): void {
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

  /**
   * POST /api/config — write the supplied config to .swt-planning/config.json.
   *
   * Two validation layers:
   *   1. Structural: ConfigUpdateBodySchema ensures the body is `{config: ...}`.
   *   2. Semantic: parseConfig from @swt-labs/core validates the inner shape
   *      against the canonical SwtConfig schema.
   * Either failure returns 400 with a typed error envelope; the daemon never
   * writes a malformed config.
   *
   * On success, atomically rewrites the file (via mkdir -p + writeFile;
   * writeFile is atomic on POSIX for paths shorter than PIPE_BUF) and
   * publishes a `state.changed` SSE event with `changed: ['config']` so other
   * tabs / panels (and the active session's Config panel) refetch.
   *
   * No DashboardPermissionGate routing — that gate is keyed to active vibe
   * sessions for agent-mediated approvals; direct UI mutations from a button
   * click follow the existing /api/init / /api/command pattern (localhost-
   * only daemon + user-initiated). See 03-RESEARCH.md for the full rationale.
   */
  app.post('/api/config', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = ConfigUpdateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_config_body', detail: parsed.error.flatten() },
        400,
      );
    }
    let validated;
    try {
      validated = parseConfig(parsed.data.config);
    } catch (err) {
      const message =
        err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err);
      return c.json({ error: 'invalid_config_schema', detail: message }, 400);
    }
    try {
      // Greenfield directories don't have .swt-planning/ yet; create on
      // demand so the first config edit doesn't crash with ENOENT before
      // /api/init has been called.
      await mkdir(dirname(cfgPath), { recursive: true });
      await writeFile(cfgPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'config_write_failed', detail: message }, 500);
    }
    if (bus !== undefined) {
      bus.publish({
        type: 'state.changed',
        ts: new Date().toISOString(),
        changed: ['config'],
        snapshot: {},
      });
    }
    const response: ConfigUpdateResponse = {
      ok: true,
      config: validated,
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });
}
