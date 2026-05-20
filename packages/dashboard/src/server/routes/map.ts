/**
 * Milestone 23 Phase 03 — `POST /api/map`.
 *
 * Spawn `swt map` as a detached subprocess so the dashboard daemon does not
 * stay coupled to the mapping job's lifetime. The `swt map` CLI fans out
 * INTERNALLY to 4 parallel **Scout** agents (per Scout Drift 1 of the
 * milestone-23 Phase 03 plan — NOT a Lead subagent) and writes its
 * outputs to `.swt-planning/codebase/`. The route itself does NOT spawn
 * Scouts directly; it only shells out to the CLI, and the 4-way fan-out
 * happens one process boundary deeper.
 *
 * Subprocess pattern mirrors `cook-start.ts` exactly (which is the
 * canonical reference for "detach + pipe stderr as JSONL + watchdog"):
 *   1. `resolveSwtCommand()` env > sibling-cli.mjs > PATH triage.
 *   2. `spawn(command, [...prefixArgs, 'map'], { cwd, env, detached, stdio })`.
 *   3. stderr → `log.append` JSONL rows appended to the daemon-events file.
 *   4. `child.unref()` so the daemon event loop is not held alive by the
 *      mapping subprocess.
 *   5. 5s fast-exit watchdog: a non-zero exit within 5s publishes a
 *      `{type: 'error', code: 'MAP_SPAWN_FAILED'}` event on the bus.
 *   6. Returns `{ session_id, pid, started_at }` to the client.
 *
 * Locked Decision #10 (vendor-agnostic init surface): the route reads no
 * provider-auth state. Mapping requires a configured provider — but that
 * gate is checked INSIDE `swt map` itself (the CLI exits non-zero when no
 * provider is configured; the 5s watchdog surfaces that as an
 * `ErrorEvent`). The route + banner remain vendor-agnostic at the HTTP/UI
 * layer.
 *
 * No request body fields. A POST with an empty body is the canonical
 * invocation; the route ignores any provided body content.
 */

import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

import { resolveSwtCommand } from './cook-start.js';

export interface MapRouteOptions {
  projectRoot: string;
  /** Test seam — swap in a fake spawn for unit tests. */
  spawnFn?: typeof spawn;
  /**
   * Optional event-bus seam for the fast-exit watchdog. When provided AND
   * `swt map` exits non-zero within 5s of spawn, the route calls
   * `bus.publish({type:'error', code:'MAP_SPAWN_FAILED', ...})` so the
   * dashboard's existing `pushError` handler fires a toast immediately,
   * bypassing the events-tailer file-tail latency.
   */
  bus?: EventBus;
}

export function registerMapRoute(app: Hono, opts: MapRouteOptions): void {
  const spawnFn = opts.spawnFn ?? spawn;

  app.post('/api/map', async (c) => {
    const sessionId = crypto.randomUUID();
    const { command, prefixArgs } = resolveSwtCommand();
    const args = [...prefixArgs, 'map'];

    // Same daemon-events filename convention as cook-start so the
    // existing events-tailer (glob `*.jsonl`) picks up the map stderr
    // log.append rows automatically.
    const daemonStartTs = new Date().toISOString();
    const sanitizedDaemonTs = daemonStartTs.replace(/[:.]/g, '-');
    const daemonEventsDir = path.join(opts.projectRoot, '.swt-planning', '.events');
    const daemonEventsPath = path.join(
      daemonEventsDir,
      `map-${sessionId}-${sanitizedDaemonTs}.jsonl`,
    );

    const child = spawnFn(command, args, {
      cwd: opts.projectRoot,
      env: {
        ...process.env,
        SWT_SESSION_ID: sessionId,
        SWT_PLANNING_ROOT: path.join(opts.projectRoot, '.swt-planning'),
      },
      detached: true,
      // pipe only stderr — `swt map`'s structured progress (if any) flows
      // through its own channels; stderr is the diagnostic surface we
      // wrap as `log.append` rows below.
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    // Stream stderr line-by-line into the daemon-events JSONL file. Lines
    // may split across `data` events so we accumulate the trailing
    // fragment. Guard for the test fake which may omit `stderr`.
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
      // the daemon event loop stays alive on the mapping subprocess
      // even though child.unref() is called below.
      if (typeof stderrStream.unref === 'function') stderrStream.unref();
    }

    // Fast-exit watchdog. We use child.once('exit', ...) rather than a
    // setTimeout so a long-running map (3-5 minutes for the 4-Scout
    // fan-out) never trips the watchdog. The fake spawn in tests may
    // omit `.once`, so we guard.
    const spawnTime = Date.now();
    const childExt = child as { once?: (ev: string, cb: (code: number | null) => void) => void };
    if (typeof childExt.once === 'function') {
      childExt.once('exit', (code: number | null) => {
        if (code !== null && code !== 0 && Date.now() - spawnTime < 5000) {
          const ts = new Date().toISOString();
          const errorEvent = {
            type: 'log.append',
            ts,
            channel: 'stderr',
            line: `[map] swt map exited with code ${code} within ${Date.now() - spawnTime}ms`,
          };
          try {
            mkdirSync(daemonEventsDir, { recursive: true });
            appendFileSync(daemonEventsPath, JSON.stringify(errorEvent) + '\n');
          } catch {
            // best-effort tailer hint; the direct bus.publish below is the
            // authoritative client-side surface.
          }
          if (opts.bus) {
            opts.bus.publish({
              type: 'error',
              ts,
              code: 'MAP_SPAWN_FAILED',
              message: `swt map spawn failed: exit ${code}`,
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
