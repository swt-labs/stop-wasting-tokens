import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ConfigError, DEFAULT_CONFIG, parseConfig } from '@swt-labs/core';
import {
  ConfigUpdateBodySchema,
  type ConfigSnapshot,
  type ConfigUpdateResponse,
} from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';
import { updateConfigFile } from '../lib/update-config-file.js';

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
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
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
      return c.json({ error: 'invalid_config_body', detail: parsed.error.flatten() }, 400);
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
      // alpha.40 — delegate the read-modify-write dance to the shared
      // `updateConfigFile` helper. The helper reads the on-disk config,
      // hands the parsed object to the mutator (which Object.assigns the
      // validated SwtConfig fields on top), and writes the result back
      // atomically with mkdir -p on the greenfield path. Sibling-owned
      // top-level keys (`auth`, `providers`) — which `parseConfig` strips
      // because they're not in `ConfigSchema` — are preserved verbatim
      // because the mutator only touches the keys IN `validated`. This is
      // the structural alpha.38 invariant: writing through `updateConfigFile`
      // makes the preservation guarantee compositional rather than
      // reimplemented per route. See `update-config-file.test.ts` for the
      // invariant tests; see `keychain_improvements.md` §1.1 + §1.2 for the
      // design rationale.
      await updateConfigFile(cfgPath, (current) => {
        Object.assign(current, validated);
      });
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
