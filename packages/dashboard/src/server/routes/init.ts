/**
 * Plan 02-01 T3 — `POST /api/init`.
 *
 * Scaffold `.swt-planning/` AND spawn the `swt init <name>` Lead subprocess
 * in a single request flow, mirroring the alpha.10 cook-bar architecture
 * (cook-start.ts). The route is non-blocking: the HTTP response carries
 * the existing InitResponse shape ({ initialized, root, files, snapshot? })
 * and returns immediately after registering the subprocess; clients learn
 * about the Lead's progress through the SSE event stream
 * (init.start / init.complete / init.error from `@swt-labs/shared`).
 *
 * Closes audit Instance #1 ("UI promises, backend drops") for the init
 * surface — pre-plan-02-01, the route scaffolded but never spawned the
 * Lead, so the dashboard's "Detecting stack…" promise had no backend
 * follow-through.
 *
 * Watchdog policy (parallel to cook-start.ts but stricter):
 *   - code === 0  → emit init.complete (success)
 *   - code !== null && code !== 0 && elapsed < 5000ms → init.error
 *                  with code = 'INIT_SPAWN_FAILED'
 *   - code !== null && code !== 0 && elapsed >= 5000ms → init.error
 *                  with code = 'INIT_FAILED'
 *
 * Cook-start is permissive about late non-zero exits because cook can
 * legitimately exit late after USER_CANCELLED; init has no equivalent
 * cancellation path, so any non-zero exit is a real failure the client
 * should see.
 */

import type { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

import {
  AlreadyInitializedError,
  initProject as defaultInitProject,
  type InitProjectOptions,
  type InitProjectResult,
} from '@swt-labs/core';
import {
  InitBodySchema,
  type InitResponse,
  type Snapshot,
  type InitStartEvent,
  type InitCompleteEvent,
  type InitErrorEvent,
} from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

import { resolveSwtCommand } from './cook-start.js';

const PLANNING_DIR = '.swt-planning';

export interface InitRouteOptions {
  /** Absolute project root. The `.swt-planning/` dir is created here. */
  projectRoot: string;
  /**
   * Called after `initProject` returns successfully so server/index.ts can
   * spin up a Snapshotter on the freshly-scaffolded root. One-shot — the
   * concrete implementation in server/index.ts no-ops on repeat calls.
   */
  onInitialized: (root: string) => void;
  /**
   * Resolves the just-spun-up snapshotter's current state after onInitialized
   * has run. Returns null if no snapshotter was attached (greenfield case).
   * The route includes the snapshot inline in the response so clients can
   * skip a follow-up GET /api/snapshot round-trip (B-08 / S-02).
   */
  getSnapshot?: () => Snapshot | null;
  /**
   * Plan 02-01 T3 — optional event-bus seam. When provided, the route
   * publishes `init.start` directly before spawn AND the watchdog publishes
   * `init.complete` / `init.error` directly on exit. The double-channel
   * pattern (JSONL append + bus.publish) matches cook-start.ts exactly:
   * the bus publish is the fast path for the SPA; the JSONL row is the
   * tailer-driven replay path for reconnects.
   */
  bus?: EventBus;
  /**
   * Plan 02-01 T3 — test seam for `node:child_process.spawn`. Defaults to
   * the real spawn at runtime. When undefined (e.g., test injection of
   * absent spawn), no subprocess is spawned — the route still scaffolds
   * and responds 200 (graceful degradation).
   */
  spawnFn?: typeof nodeSpawn;
  /**
   * Plan 02-01 T3 — test seam for `initProject`. Defaults to the real
   * `@swt-labs/core` implementation. Tests inject a fake to (a) avoid
   * touching the real FS during the scaffold step and (b) drive the
   * AlreadyInitializedError branch deterministically.
   */
  initProject?: (options: InitProjectOptions) => InitProjectResult;
}

export function registerInitRoute(app: Hono, opts: InitRouteOptions): void {
  const initProjectFn = opts.initProject ?? defaultInitProject;
  // Note: spawnFn is intentionally NOT defaulted to nodeSpawn here. Plan
  // 02-01's "graceful degradation" invariant means: when the caller
  // (server/index.ts) registers WITHOUT spawnFn, the route scaffolds +
  // responds 200 but does NOT spawn the Lead. server/index.ts will pass
  // nodeSpawn explicitly (or rely on the default at the use-site below).
  const spawnFn = opts.spawnFn;
  const getSnapshot = opts.getSnapshot ?? (() => null);

  app.post('/api/init', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = InitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    let result: InitProjectResult;
    try {
      result = initProjectFn({
        cwd: opts.projectRoot,
        name: parsed.data.name,
        description: parsed.data.description,
        source: 'dashboard',
      });
    } catch (err: unknown) {
      if (err instanceof AlreadyInitializedError) {
        return c.json(
          {
            error: 'already_initialized',
            detail: `${PLANNING_DIR}/ already exists at ${opts.projectRoot}`,
          },
          409,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'init_failed', detail: message }, 500);
    }

    // Scaffold succeeded — wire up snapshotter (so getSnapshot below returns
    // non-null) BEFORE emitting init.start so the client receives a
    // coherent first SSE frame: snapshot is ready, Lead is starting.
    opts.onInitialized(result.root);

    // Plan 02-01 T3 — Lead subprocess spawn. Wrapped in try/catch so a
    // failure here (e.g. spawn ENOENT, missing PATH binary) never crashes
    // the HTTP response — scaffold already succeeded; the client will
    // see init.error on the SSE channel and re-render appropriately.
    const sessionId = randomUUID();
    const daemonStartTs = new Date().toISOString();
    const sanitizedDaemonTs = daemonStartTs.replace(/[:.]/g, '-');
    const daemonEventsDir = path.join(opts.projectRoot, PLANNING_DIR, '.events');
    const daemonEventsPath = path.join(
      daemonEventsDir,
      `init-${sessionId}-${sanitizedDaemonTs}.jsonl`,
    );

    try {
      // 1. Emit init.start to the JSONL channel AND directly on the bus.
      //    The double-channel pattern matches cook-start.ts: JSONL is the
      //    tailer-driven replay path; bus.publish is the fast fan-out to
      //    live SSE subscribers (no tailer-glob latency).
      const initStartEvt: InitStartEvent = {
        type: 'init.start',
        ts: daemonStartTs,
        session_id: sessionId,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
      };
      mkdirSync(daemonEventsDir, { recursive: true });
      appendFileSync(daemonEventsPath, JSON.stringify(initStartEvt) + '\n');
      if (opts.bus) {
        opts.bus.publish(initStartEvt);
      }

      // 2. Spawn the Lead subprocess (when a spawnFn is available). The
      //    `--description` flag is OMITTED entirely when description is
      //    absent; we do not pass an empty `'--description', ''` because
      //    the CLI parser at packages/cli/src/commands/init.ts treats the
      //    next positional as a description when --description is absent
      //    but conflict-detects when it's present with an empty value.
      if (spawnFn) {
        const { command, prefixArgs } = resolveSwtCommand();
        const extraArgs = parsed.data.description ? ['--description', parsed.data.description] : [];
        // alpha.15 — `--skip-scaffold` is mandatory: the route already
        // scaffolded `.swt-planning/` synchronously via `initProjectFn()`
        // above, so the subprocess MUST NOT re-invoke initProject()
        // (which would throw AlreadyInitializedError and exit 1). The CLI
        // honors --skip-scaffold by jumping straight to the Lead spawn.
        const child = spawnFn(
          command,
          [...prefixArgs, 'init', parsed.data.name, ...extraArgs, '--skip-scaffold'],
          {
            cwd: opts.projectRoot,
            env: {
              ...process.env,
              SWT_SESSION_ID: sessionId,
              SWT_PLANNING_ROOT: path.join(opts.projectRoot, PLANNING_DIR),
            },
            detached: true,
            // Milestone 19 Phase 01 — BOTH stdout and stderr piped so we
            // can mirror the subprocess's output to the events JSONL.
            // - stderr feeds the existing alpha.20 ring buffer that
            //   populates init.error envelopes on fast-exit failures.
            // - stdout (new in milestone 19) surfaces the CLI handler's
            //   contract lines AND the pre-spawn OAuth advisory to the
            //   dashboard log panel, replacing the prior "tokens spent
            //   but no visible activity" gap.
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );

        // alpha.15 — pipe child stderr into the events JSONL as `log.append`
        // rows so dashboard users can see WHY the subprocess crashed.
        // Mirrors cook-start.ts's pattern. Lines are buffered + flushed on
        // \n so partial writes don't fragment a single error message.
        //
        // alpha.20 — ALSO retain the last N stderr lines in memory so the
        // watchdog can include them inline in the `init.error` message body
        // (Bug B — error surfacing). Pre-alpha.20, the dashboard's init
        // error card rendered only the bare envelope ("init exited with
        // code N within Xms"), hiding the real cause that init.ts had
        // already written to the JSONL. Mirrors the milestone-10 git stderr
        // leak fix: capture upstream stderr and surface it to the consumer.
        const childWithStderr = child as { stderr?: NodeJS.ReadableStream | null };
        const recentStderrLines: string[] = [];
        const RECENT_STDERR_CAP = 8;
        if (childWithStderr.stderr) {
          let stderrBuf = '';
          childWithStderr.stderr.on('data', (chunk: Buffer | string) => {
            stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            let nl: number;
            while ((nl = stderrBuf.indexOf('\n')) >= 0) {
              const line = stderrBuf.slice(0, nl);
              stderrBuf = stderrBuf.slice(nl + 1);
              if (line.length === 0) continue;
              // Retain in ring-buffer-style cap so a chatty Lead can't
              // unbounded-grow this array (the dashboard already throttles
              // log.append events; this is just for the error envelope).
              recentStderrLines.push(line);
              if (recentStderrLines.length > RECENT_STDERR_CAP) {
                recentStderrLines.shift();
              }
              try {
                mkdirSync(daemonEventsDir, { recursive: true });
                appendFileSync(
                  daemonEventsPath,
                  JSON.stringify({
                    type: 'log.append',
                    ts: new Date().toISOString(),
                    channel: 'stderr',
                    line,
                  }) + '\n',
                );
              } catch {
                // best-effort
              }
            }
          });
        }

        // Milestone 19 Phase 01 — pipe child stdout into the events JSONL
        // as `log.append` rows with `channel: 'stdout'`. Mirrors the
        // stderr-mirror block above byte-for-byte except:
        //   - no ring buffer: the alpha.20 ring exists ONLY to feed
        //     `init.error` envelopes on fast-exit failures; stdout does
        //     not feed that path (it carries normal CLI handler output,
        //     not error context).
        //   - channel discriminator is `'stdout'` instead of `'stderr'`.
        // Surfaces the CLI handler's contract lines AND the pre-spawn
        // OAuth advisory (init.ts:278-284 in the cook subprocess — Phase
        // 02 rewrites that advisory) to the dashboard log panel. Closes
        // the visibility gap where users could spend tokens without ever
        // seeing the CLI's progress text in the dashboard.
        const childWithStdout = child as { stdout?: NodeJS.ReadableStream | null };
        if (childWithStdout.stdout) {
          let stdoutBuf = '';
          childWithStdout.stdout.on('data', (chunk: Buffer | string) => {
            stdoutBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            let nl: number;
            while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
              const line = stdoutBuf.slice(0, nl);
              stdoutBuf = stdoutBuf.slice(nl + 1);
              if (line.length === 0) continue;
              try {
                mkdirSync(daemonEventsDir, { recursive: true });
                appendFileSync(
                  daemonEventsPath,
                  JSON.stringify({
                    type: 'log.append',
                    ts: new Date().toISOString(),
                    channel: 'stdout',
                    line,
                  }) + '\n',
                );
              } catch {
                // best-effort
              }
            }
          });
        }

        // 3. Fast-exit watchdog. Mirrors cook-start.ts: child.once('exit')
        //    fires when the process actually exits — NOT a setTimeout
        //    countdown — so a long-lived Lead waiting on askUser never
        //    trips the 5s window. spawnTime is captured BEFORE the
        //    `child.once` registration so an immediate exit still
        //    sees `Date.now() - spawnTime < 5000`.
        const spawnTime = Date.now();
        const childExt = child as {
          once?: (ev: string, cb: (code: number | null) => void) => void;
        };
        if (typeof childExt.once === 'function') {
          childExt.once('exit', (code: number | null) => {
            try {
              const ts = new Date().toISOString();
              if (code === 0) {
                // Clean exit — Lead completed successfully.
                const completeEvt: InitCompleteEvent = {
                  type: 'init.complete',
                  ts,
                  session_id: sessionId,
                  status: 'success',
                };
                mkdirSync(daemonEventsDir, { recursive: true });
                appendFileSync(daemonEventsPath, JSON.stringify(completeEvt) + '\n');
                if (opts.bus) {
                  opts.bus.publish(completeEvt);
                }
              } else if (code !== null) {
                // Non-zero exit. Fast (<5s) ⇒ INIT_SPAWN_FAILED; late
                // (>=5s) ⇒ INIT_FAILED. See file header for rationale.
                const elapsed = Date.now() - spawnTime;
                const isFastExit = elapsed < 5000;
                const envelope = isFastExit
                  ? `init exited with code ${code} within ${elapsed}ms`
                  : `init exited with code ${code}`;
                // alpha.20 — append the captured stderr tail so the dashboard
                // error card surfaces the real cause inline. The CLI's init.ts
                // writes its own diagnostic line (e.g. "Lead spawn returned
                // status=failed. Summary: <Pi error>") via stderr — that line
                // is what users need to see. If nothing was captured (rare —
                // means the subprocess crashed before any stderr), the
                // envelope stays alone.
                const cause = recentStderrLines.join('\n');
                const message = cause.length > 0 ? `${envelope}\n\n${cause}` : envelope;
                const errEvt: InitErrorEvent = {
                  type: 'init.error',
                  ts,
                  session_id: sessionId,
                  code: isFastExit ? 'INIT_SPAWN_FAILED' : 'INIT_FAILED',
                  message,
                };
                mkdirSync(daemonEventsDir, { recursive: true });
                appendFileSync(daemonEventsPath, JSON.stringify(errEvt) + '\n');
                if (opts.bus) {
                  opts.bus.publish(errEvt);
                }
              }
              // code === null (signal-killed) is intentionally a no-op
              // here: the client still has the init.start state and will
              // time out on its own UI clock if needed.
            } catch {
              // Event emission must never crash the daemon. Swallow.
            }
          });
        }

        // 4. Mandatory when stdio is piped with detached:true — without
        //    this, the daemon event loop stays alive on the Lead's
        //    lifetime even though we want a detached, fire-and-forget
        //    subprocess. Mirrors cook-start.ts line 215.
        if (typeof child.unref === 'function') child.unref();
      }
    } catch (err: unknown) {
      // Synchronous spawn failure (ENOENT, permission, etc.). Emit a
      // single init.error so the client surfaces the failure; do not
      // throw out of the route handler — the scaffold already succeeded
      // and the HTTP response should still return 200.
      const ts = new Date().toISOString();
      const message = err instanceof Error ? err.message : String(err);
      const errEvt: InitErrorEvent = {
        type: 'init.error',
        ts,
        session_id: sessionId,
        code: 'INIT_SPAWN_FAILED',
        message: `init spawn threw: ${message}`,
      };
      try {
        mkdirSync(daemonEventsDir, { recursive: true });
        appendFileSync(daemonEventsPath, JSON.stringify(errEvt) + '\n');
      } catch {
        /* best-effort */
      }
      if (opts.bus) {
        try {
          opts.bus.publish(errEvt);
        } catch {
          /* best-effort */
        }
      }
    }

    const snapshot = getSnapshot();
    const response: InitResponse = {
      initialized: true,
      root: result.root,
      files: [...result.files],
      ...(snapshot !== null ? { snapshot } : {}),
    };
    return c.json(response);
  });
}
