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
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

export interface CookStartOptions {
  projectRoot: string;
  /** Test seam — swap in a fake spawn for unit tests. */
  spawnFn?: typeof spawn;
  /**
   * Phase 01 (Cook IPC plumbing) — optional event-bus seam for the
   * fast-exit watchdog. When provided AND cook exits non-zero within 5s
   * of spawn, the route calls `bus.publish({type:'error', ...})` so the
   * dashboard's existing `pushError` handler (dashboard-store.ts:725)
   * fires a toast immediately, bypassing the events-tailer file-tail
   * latency. The route still writes a `cook.error` JSONL row to the
   * cook-events file regardless (for the tailer-driven SSE path).
   */
  bus?: EventBus;
}

interface CookStartBody {
  /** Optional positional/flag arguments to forward to `swt cook`. */
  args?: ReadonlyArray<string>;
  /**
   * Phase 01 (Cook IPC plumbing) — when present and non-empty after trim,
   * the route writes the trimmed value to
   * `.swt-planning/.pending-scope-idea.txt` BEFORE spawning `swt cook`.
   * Cook's Scope mode pre-fills its "what to build?" askUser answer
   * from that seed file (Phase 02 consumption wiring). Empty / absent
   * prompts leave any prior seed file untouched.
   */
  prompt?: string;
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

    // Phase 01 (Cook IPC plumbing) — seed-file write.
    // When the dashboard's cook-bar carries a non-empty prompt, persist it
    // to `.swt-planning/.pending-scope-idea.txt` so cook can pre-fill its
    // Scope-mode "what to build?" askUser answer on any entry path (Phase
    // 02 wires the actual consumption + deletion). Empty / whitespace
    // prompts intentionally do NOT create or overwrite the file — a prior
    // un-consumed seed survives so the user can retry without retyping.
    if (typeof body.prompt === 'string' && body.prompt.trim().length > 0) {
      const seedDir = path.join(opts.projectRoot, '.swt-planning');
      const seedPath = path.join(seedDir, '.pending-scope-idea.txt');
      mkdirSync(seedDir, { recursive: true });
      writeFileSync(seedPath, body.prompt.trim(), 'utf8');
    }

    const { command, prefixArgs } = resolveCookCommand();
    const args = [...prefixArgs, 'cook', ...extraArgs];

    // Phase 01 (Cook IPC plumbing) — daemon-side cook-events filename for
    // log.append + cook.error rows. Cook itself ALSO writes a file matching
    // `cook-{sessionId}-{cookStartTs}.jsonl` once it boots (~50-200ms after
    // spawn), and the events-tailer glob `*.jsonl` picks up both files.
    // We compute our timestamp here so the filename is stable across the
    // exit-callback closure even though cook's startTs differs.
    const daemonStartTs = new Date().toISOString();
    const sanitizedDaemonTs = daemonStartTs.replace(/[:.]/g, '-');
    const daemonEventsDir = path.join(opts.projectRoot, '.swt-planning', '.events');
    const daemonEventsPath = path.join(
      daemonEventsDir,
      `cook-${sessionId}-${sanitizedDaemonTs}.jsonl`,
    );

    const child = spawnFn(command, args, {
      cwd: opts.projectRoot,
      env: {
        ...process.env,
        SWT_SESSION_ID: sessionId,
        SWT_PLANNING_ROOT: path.join(opts.projectRoot, '.swt-planning'),
      },
      detached: true,
      // Phase 01 — pipe only stderr. Cook's structured output already
      // flows through its own cook-events JSONL (emitCookEvent); stdout
      // stays 'ignore' to avoid duplicating that channel. stderr is the
      // raw error/diagnostic channel and is wrapped as `log.append` rows
      // with `channel: 'stderr'` below so the events-tailer → SSE →
      // LogPanel pipeline surfaces it.
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    // Phase 01 — read child.stderr line-by-line, wrap each line as a
    // `log.append` JSONL row, and append to the daemon's cook-events
    // file. Lines may split across `data` events so we accumulate the
    // trailing fragment between chunks. Guard for the test fake which
    // returns `{pid, unref}` with no stderr stream attached.
    const stderrStream = (child as { stderr?: unknown }).stderr as
      | { on?: (ev: string, cb: (chunk: Buffer | string) => void) => void; unref?: () => void }
      | undefined;
    if (stderrStream && typeof stderrStream.on === 'function') {
      let stderrBuf = '';
      stderrStream.on('data', (chunk: Buffer | string) => {
        stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let nlIdx = stderrBuf.indexOf('\n');
        while (nlIdx !== -1) {
          const line = stderrBuf.slice(0, nlIdx);
          stderrBuf = stderrBuf.slice(nlIdx + 1);
          const event = {
            type: 'log.append',
            ts: new Date().toISOString(),
            channel: 'stderr',
            line,
          };
          try {
            mkdirSync(daemonEventsDir, { recursive: true });
            appendFileSync(daemonEventsPath, JSON.stringify(event) + '\n');
          } catch {
            // Event emission must never crash the daemon's request handler.
          }
          nlIdx = stderrBuf.indexOf('\n');
        }
      });
      // Mandatory when stdio is piped with detached:true — without this,
      // the daemon event loop stays alive on cook's lifetime even though
      // child.unref() is also called. See research §F.3.
      if (typeof stderrStream.unref === 'function') stderrStream.unref();
    }

    // Phase 01 — fast-exit watchdog. If cook exits non-zero within 5s of
    // spawn we treat it as a spawn failure (binary missing, permission
    // error, immediate RUNTIME_ERROR abort) and surface a toast. We use
    // child.once('exit', ...) (NOT setTimeout) so a long-lived cook
    // waiting on askUser never trips the watchdog. The fake spawn in the
    // tests returns `{pid, unref}` with no `.once`, so we guard.
    const spawnTime = Date.now();
    const childExt = child as { once?: (ev: string, cb: (code: number | null) => void) => void };
    if (typeof childExt.once === 'function') {
      childExt.once('exit', (code: number | null) => {
        if (code !== null && code !== 0 && Date.now() - spawnTime < 5000) {
          const ts = new Date().toISOString();
          const cookErrorEvent = {
            type: 'cook.error',
            ts,
            session_id: sessionId,
            code: 'COOK_SPAWN_FAILED',
            message: `cook exited with code ${code} within ${Date.now() - spawnTime}ms`,
          };
          try {
            mkdirSync(daemonEventsDir, { recursive: true });
            appendFileSync(daemonEventsPath, JSON.stringify(cookErrorEvent) + '\n');
          } catch {
            // best-effort tailer hint; the direct bus.publish below is the
            // authoritative client-side surface.
          }
          if (opts.bus) {
            opts.bus.publish({
              type: 'error',
              ts,
              code: 'COOK_SPAWN_FAILED',
              message: `cook spawn failed: exit ${code}`,
            });
          }
        }
      });
    }

    if (typeof child.unref === 'function') child.unref();

    return c.json({
      session_id: sessionId,
      pid: child.pid ?? null,
      started_at: daemonStartTs,
    });
  });
}
