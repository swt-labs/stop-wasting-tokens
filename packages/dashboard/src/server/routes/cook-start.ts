/**
 * Plan 04-02 T3 — `POST /api/cook/start`.
 *
 * Spawn `swt cook` as a detached subprocess so the dashboard daemon does not
 * stay coupled to the cook session's lifetime. The session_id is generated
 * here and passed through the `SWT_SESSION_ID` env var so cook's
 * resolveSessionId() picks up the dashboard's id (rather than minting its
 * own random one). Keeping the id aligned means the dashboard's "active
 * session" pointer matches cook's `.swt-planning/.events/cook-{id}-*.jsonl`
 * file naming, which the events-tailer + cost reducer both key off.
 *
 * R6 (statusline-only) — we do NOT pass a `--session-id` flag because cook
 * already reads `SWT_SESSION_ID` from env; adding a new flag would expand
 * cook's CLI surface beyond what plan 04-01 shipped.
 *
 * R4 (dashboard auth) is DEFERRED to Phase 6; binding-guard.ts already
 * restricts the dashboard to 127.0.0.1 so a local caller is the only path
 * that reaches this route in v3.
 */

import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hono } from 'hono';

export interface CookStartOptions {
  projectRoot: string;
  /** Test seam — swap in a fake spawn for unit tests. */
  spawnFn?: typeof spawn;
}

interface CookStartBody {
  /** Optional positional/flag arguments to forward to `swt cook`. */
  args?: ReadonlyArray<string>;
}

function resolveCookCommand(): { command: string; prefixArgs: string[] } {
  // Prefer the sibling cli.mjs bundle when the daemon is running from the
  // published tarball; fall back to the PATH `swt` binary. Mirrors the
  // routes/command.ts resolution.
  const envOverride = process.env['SWT_BIN'];
  if (envOverride && envOverride.length > 0) {
    return { command: envOverride, prefixArgs: [] };
  }
  try {
    const here = fileURLToPath(import.meta.url);
    const adjacent = path.join(dirname(here), 'cli.mjs');
    if (existsSync(adjacent)) {
      return { command: 'node', prefixArgs: [adjacent] };
    }
  } catch {
    /* fallthrough */
  }
  return { command: 'swt', prefixArgs: [] };
}

export function registerCookStartRoute(app: Hono, opts: CookStartOptions): void {
  const spawnFn = opts.spawnFn ?? spawn;

  app.post('/api/cook/start', async (c) => {
    const body: CookStartBody = await c.req.json<CookStartBody>().catch(() => ({}));
    const extraArgs = Array.isArray(body.args)
      ? body.args.filter((a: unknown): a is string => typeof a === 'string')
      : [];
    const sessionId = crypto.randomUUID();
    const { command, prefixArgs } = resolveCookCommand();
    const args = [...prefixArgs, 'cook', ...extraArgs];

    const child = spawnFn(command, args, {
      cwd: opts.projectRoot,
      env: {
        ...process.env,
        SWT_SESSION_ID: sessionId,
        SWT_PLANNING_ROOT: path.join(opts.projectRoot, '.swt-planning'),
      },
      detached: true,
      stdio: 'ignore',
    });

    if (typeof child.unref === 'function') child.unref();

    return c.json({
      session_id: sessionId,
      pid: child.pid ?? null,
      started_at: new Date().toISOString(),
    });
  });
}
