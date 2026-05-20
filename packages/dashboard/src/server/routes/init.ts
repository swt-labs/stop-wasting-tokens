/**
 * `POST /api/init` — synchronous server scaffold.
 *
 * Milestone 23 Phase 01 T03 — the Lead-subprocess spawn block (alpha.10's
 * plan-02-01 T3 implementation) is REMOVED. The route now:
 *
 *   1. Validates the body via `InitBodySchema` (`.strict()` rejects unknown
 *      fields — AC 29; no `provider_id` per Locked Decision #10 / AC 30).
 *   2. Calls `initProject()` synchronously. The L1 helper writes all 6
 *      planning files, runs `git init` silently when absent, runs
 *      detect-stack.sh for brownfield projects, bootstraps CLAUDE.md, syncs
 *      `.gitignore`, and installs git pre-push hooks — wall-clock <1s
 *      greenfield, 2-5s brownfield.
 *   3. Emits `init.start` + `init.complete` synchronously on the JSONL
 *      channel + the EventBus around the `initProjectFn()` call. The
 *      double-channel pattern (JSONL row + bus.publish) is preserved for
 *      tailer-driven reconnects.
 *   4. Returns the enriched `InitResponse` with `brownfield`,
 *      `git_initialized`, and `stack` so the wizard's Step 3 can render
 *      the correct completion screen without a follow-up snapshot fetch.
 *
 * Why the Lead spawn went away: the original architecture used the Lead
 * agent's AskUserQuestion primitive to interactively collect project
 * decisions during init. AskUserQuestion does NOT work in the detached-
 * subprocess SSE context the dashboard provides (decision #16 in the
 * milestone-23 proposal). The dashboard's Initialize Wizard v2 collects
 * decisions UPFRONT in Steps 1-2 and passes them through this route, so
 * the synchronous scaffold has everything it needs at call time.
 *
 * The CLI path (`swt init` from Claude Code) keeps the Lead because
 * Claude Code IS an interactive AskUserQuestion environment. That path
 * is unchanged by this milestone.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

import {
  AlreadyInitializedError,
  initProject as defaultInitProject,
  type InitProjectOptions,
  type InitProjectResult,
} from '@swt-labs/core/scaffold/init-project.js';
import {
  InitBodySchema,
  type InitResponse,
  type Snapshot,
  type InitStartEvent,
  type InitCompleteEvent,
} from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

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
   * Optional event-bus seam. When provided, the route publishes
   * `init.start` and `init.complete` directly on the bus AROUND the
   * synchronous initProjectFn() call. The double-channel pattern (JSONL
   * append + bus.publish) is preserved for tailer-driven reconnects.
   */
  bus?: EventBus;
  /**
   * Test seam for `initProject`. Defaults to the real `@swt-labs/core`
   * implementation. Tests inject a fake to (a) avoid touching the real FS
   * during the scaffold step and (b) drive the AlreadyInitializedError
   * branch deterministically.
   */
  initProject?: (options: InitProjectOptions) => InitProjectResult;
}

export function registerInitRoute(app: Hono, opts: InitRouteOptions): void {
  const initProjectFn = opts.initProject ?? defaultInitProject;
  const getSnapshot = opts.getSnapshot ?? (() => null);

  app.post('/api/init', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = InitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }

    // Allocate a session_id + JSONL events file before the scaffold runs
    // so init.start can land regardless of whether initProject() throws.
    const sessionId = randomUUID();
    const startTs = new Date().toISOString();
    const sanitizedTs = startTs.replace(/[:.]/g, '-');
    const daemonEventsDir = path.join(opts.projectRoot, PLANNING_DIR, '.events');
    const daemonEventsPath = path.join(daemonEventsDir, `init-${sessionId}-${sanitizedTs}.jsonl`);

    let result: InitProjectResult;
    try {
      result = initProjectFn({
        cwd: opts.projectRoot,
        name: parsed.data.name,
        description: parsed.data.description,
        planningTracking: parsed.data.planning_tracking,
        autoPush: parsed.data.auto_push,
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

    // Scaffold succeeded — wire up snapshotter BEFORE emitting the
    // synchronous lifecycle events so the client receives a coherent
    // first SSE frame: snapshot ready, init.start + init.complete already
    // in the tailer-driven JSONL.
    opts.onInitialized(result.root);

    // Emit init.start + init.complete synchronously to the JSONL channel
    // AND directly on the bus. The double-channel pattern is preserved
    // from the alpha.10 spawn architecture (JSONL is the tailer-driven
    // replay path for reconnects; bus.publish is the fast fan-out to
    // live SSE subscribers). Events fire AROUND the scaffold call: start
    // immediately before the success-path branch enters, complete after
    // the snapshotter wire-up.
    try {
      mkdirSync(daemonEventsDir, { recursive: true });

      const initStartEvt: InitStartEvent = {
        type: 'init.start',
        ts: startTs,
        session_id: sessionId,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
      };
      appendFileSync(daemonEventsPath, JSON.stringify(initStartEvt) + '\n');
      if (opts.bus) opts.bus.publish(initStartEvt);

      const initCompleteEvt: InitCompleteEvent = {
        type: 'init.complete',
        ts: new Date().toISOString(),
        session_id: sessionId,
        status: 'success',
        brownfield: result.brownfield,
        git_initialized: result.gitInitialized,
        stack: [...result.stack],
      };
      appendFileSync(daemonEventsPath, JSON.stringify(initCompleteEvt) + '\n');
      if (opts.bus) opts.bus.publish(initCompleteEvt);
    } catch {
      // Event emission is best-effort — the scaffold itself has already
      // succeeded so the HTTP response should still return 200 with the
      // enriched body. JSONL write failure here means the tailer-driven
      // replay path is broken for this session, but the bus.publish
      // (when present) has already delivered the live events to live
      // subscribers in the success path above.
    }

    const snapshot = getSnapshot();
    const response: InitResponse = {
      initialized: true,
      root: result.root,
      files: [...result.files],
      brownfield: result.brownfield,
      git_initialized: result.gitInitialized,
      stack: [...result.stack],
      ...(snapshot !== null ? { snapshot } : {}),
    };
    return c.json(response);
  });
}
