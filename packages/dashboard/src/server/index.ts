import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import chokidar from 'chokidar';
import { Hono } from 'hono';

import { createLiveBudgetWiring, type BudgetWiring } from './budget-routes.js';
import { ChatSessionRegistry } from './chat-session-registry.js';
import { createEventBus, type EventBus } from './event-bus.js';
import { requireToken, resolveDashboardToken } from './lib/auth.js';
import { assertSafeBinding } from './lib/binding-guard.js';
import { securityHeadersMiddleware } from './lib/csp.js';
import { createFileBackedMeterGetter } from './lib/file-backed-meter.js';
import { findProjectRoot } from './lib/find-project-root.js';
import { registerArtifactDiffRoute } from './routes/artifact-diff.js';
import { registerArtifactHistoryRoute } from './routes/artifact-history.js';
import { registerArtifactRoute } from './routes/artifact.js';
import { registerBudgetRoute } from './routes/budget.js';
import { registerCacheHitsRoute } from './routes/cache-hits.js';
import { createChatRoute } from './routes/chat.js';
import { registerCommandRoute } from './routes/command.js';
import { registerCommandsRoute } from './routes/commands.js';
import { registerConfigRoute } from './routes/config.js';
import { registerCookControlRoute } from './routes/cook-control.js';
import { registerCookRespondRoute } from './routes/cook-respond.js';
import { registerCookStartRoute } from './routes/cook-start.js';
import { registerDebugEmitRoute } from './routes/debug-emit.js';
import { registerDetectPhaseRoute } from './routes/detect-phase.js';
import { registerDoctorRoute } from './routes/doctor.js';
import { registerEventsRoute } from './routes/events.js';
import { registerHealthRoute } from './routes/health.js';
import { registerInitRoute } from './routes/init.js';
import { registerModelsRoute } from './routes/models.js';
import { registerPromptsRoute } from './routes/prompts.js';
import { registerProviderAuthOAuthRoute } from './routes/provider-auth-oauth.js';
import { registerProviderAuthRoute } from './routes/provider-auth.js';
import { registerProviderCostRoute } from './routes/provider-cost.js';
import { registerSnapshotRoute } from './routes/snapshot.js';
import { registerTpacRoute } from './routes/tpac.js';
import { registerUatCheckpointRoute } from './routes/uat-checkpoint.js';
import { registerUpdateRoute } from './routes/update.js';
import { createUsageRollupRoute } from './routes/usage-rollup.js';
import { registerUserNotesRoute } from './routes/user-notes.js';
import { registerWorktreesRoute } from './routes/worktrees.js';
import { createSnapshotter, type Snapshotter } from './snapshot/snapshotter.js';
import { createUsageAggregator, type UsageAggregator } from './usage-aggregator.js';

// Plan 01-03 (milestone 12, Phase 01) — re-export so dashboard-side tests
// + future external consumers can construct seamed registries (test mode)
// or reach into the server's chat-session lifecycle without dotted-path
// imports.
export { ChatSessionRegistry } from './chat-session-registry.js';

export interface DashboardServer {
  app: Hono;
  server: ServerType;
  bus: EventBus;
  snapshotter: Snapshotter | null;
  projectRoot: string | null;
  port: number;
  hostname: string;
  close: () => Promise<void>;
}

export interface CreateServerOptions {
  /** Port to bind. Use 0 for OS-assigned. Default: PORT env or 54321. */
  port?: number;
  /** Bind hostname. Default: 127.0.0.1. Set to '0.0.0.0' only with allowPublic=true. */
  hostname?: string;
  /** Required to allow non-loopback bindings. */
  allowPublic?: boolean;
  /**
   * Project root containing .swt-planning/. If omitted, the server will try
   * findProjectRoot() at startup; if that fails, snapshot/artifact routes are
   * not registered (only health + events + debug-emit), which is the test-
   * friendly mode used by Phase 01 unit tests.
   */
  projectRoot?: string;
  /** Skip snapshot watcher even if projectRoot is provided. For tests. */
  skipSnapshotter?: boolean;
  /**
   * Plan 06-03 T4 (Phase 4 R4 carry-forward) — opt into the per-boot
   * dashboard token gate. When `true`, the daemon writes a fresh 32-byte
   * hex token to `.swt-planning/.dashboard/token` (or reads
   * `SWT_DASHBOARD_TOKEN` if set), and every `/api/*` request except
   * `/api/health` must carry `Authorization: Bearer <token>`. When
   * `false` (default), the daemon binds loopback-only with no auth gate.
   *
   * Auto-enabled when `SWT_DASHBOARD_TOKEN` env var is set + non-empty.
   */
  authEnabled?: boolean;
}

const DEFAULT_PORT = 54321;
const LOOPBACK = '127.0.0.1';

export function createApp(
  opts: {
    bus?: EventBus;
    startedAt?: number;
    projectRoot?: string;
    snapshotter?: Snapshotter;
    /**
     * Plan 06-03 T4 — when provided, install `requireToken` middleware
     * on `/api/*` after the security-headers middleware and BEFORE any
     * routes. `/api/health` is exempt (liveness probes). Tests inject
     * a pre-set token to avoid filesystem coupling; production wiring
     * calls `resolveDashboardToken()` upstream in `createServer`.
     */
    authToken?: string;
    /**
     * Plan 01-03 (milestone 12, Phase 01) — optional pre-constructed
     * ChatSessionRegistry. Tests inject a registry built with
     * `setIntervalFn` / `now` seams so they can drive TTL sweeps
     * deterministically; production wiring constructs a default
     * registry (10-min TTL, `setInterval(...).unref()`).
     */
    chatRegistry?: ChatSessionRegistry;
    /**
     * Plan 01-03 — optional TTL override for the default chat
     * registry. Ignored when `chatRegistry` is provided.
     */
    chatSessionTtlMs?: number;
  } = {},
): {
  app: Hono;
  bus: EventBus;
  snapshotter: Snapshotter | null;
  projectRoot: string | null;
  budgetWiring: BudgetWiring | null;
  usageAggregator: UsageAggregator;
  chatRegistry: ChatSessionRegistry;
} {
  const bus = opts.bus ?? createEventBus();
  const startedAt = opts.startedAt ?? Date.now();
  // Plan 01-03 (milestone 12, Phase 01) — ChatSessionRegistry holds live
  // SwtSession handles for the Free-talk Mode chat route. Tests inject a
  // pre-built registry (with seamed setInterval / now) so they can drive
  // TTL sweeps deterministically; production wiring builds a default with
  // the 10-min idle TTL + setInterval(...).unref() so the daemon's event
  // loop is not pinned by the chat registry's sweep timer.
  const chatRegistry =
    opts.chatRegistry ??
    new ChatSessionRegistry(
      opts.chatSessionTtlMs !== undefined ? { ttlMs: opts.chatSessionTtlMs } : {},
    );
  const app = new Hono();
  // v2.3.4: defense-in-depth security headers — must be registered before
  // any route so every response (incl. static SPA assets + 404s) is covered.
  // The CSP directive blocks browser-extension MAIN_WORLD script injection
  // (MetaMask / Yoroi / Phantom / Rabby), which otherwise drops SES lockdown
  // into the page and breaks Solid reactivity + the natural-language
  // classifier. `SWT_DASHBOARD_NO_CSP=1` opts out for users who need to
  // load custom scripts (e.g., during dev). See lib/csp.ts for the full
  // rationale + directive list.
  app.use(
    '*',
    securityHeadersMiddleware({
      disableCsp: process.env['SWT_DASHBOARD_NO_CSP'] === '1',
    }),
  );
  // Plan 06-03 T4 (Phase 4 R4) — per-boot dashboard token gate. Applied
  // to `/api/*` so static SPA assets stay public; `/api/health` is
  // exempt via the middleware's internal allowlist (liveness probes
  // shouldn't need the token).
  if (opts.authToken !== undefined && opts.authToken.length > 0) {
    app.use('/api/*', requireToken({ token: opts.authToken }));
  }
  registerHealthRoute(app, startedAt);
  // B-09: pass a snapshot getter so SSE writes an initial snapshot.replace
  // frame on connect. The getter reads the live `snapshotter` closure so
  // greenfield daemons that gain a snapshotter mid-session start emitting
  // initial frames automatically.
  registerEventsRoute(app, bus, () => snapshotter?.current() ?? null);
  registerDebugEmitRoute(app, bus);

  let snapshotter: Snapshotter | null = opts.snapshotter ?? null;
  let projectRoot: string | null = opts.projectRoot ?? null;
  if (snapshotter && !projectRoot) {
    // best-effort: snapshotter was injected without explicit root; skip routes that need a root
  }
  if (projectRoot && !snapshotter) {
    snapshotter = createSnapshotter({ projectRoot, bus });
  } else if (!snapshotter) {
    // B-11: greenfield daemon — register a one-shot parent-dir watcher on
    // cwd/.swt-planning/ so a terminal-side `swt init` (or any other path
    // that creates the planning dir without going through /api/init) is
    // auto-detected. When the dir appears, spin up the snapshotter just
    // like onInitialized does and close the watcher.
    const cwdValue = process.cwd();
    const planningPath = join(cwdValue, '.swt-planning');
    const greenfieldWatcher = chokidar.watch(planningPath, {
      ignoreInitial: false,
      // persistent:false keeps this watcher from holding the event loop open
      // on its own — when the snapshotter takes over, the daemon's normal
      // chokidar instance keeps the loop alive.
      persistent: false,
      depth: 0,
    });
    greenfieldWatcher.on('addDir', (p) => {
      if (p !== planningPath || snapshotter) return;
      snapshotter = createSnapshotter({ projectRoot: cwdValue, bus });
      projectRoot = cwdValue;
      void greenfieldWatcher.close();
    });
  }
  // Init + command always register — they're how a greenfield user goes from
  // "no .swt-planning/" to a connected dashboard, and how power users invoke
  // arbitrary `swt` verbs from the TopBar input.
  const cwd = projectRoot ?? process.cwd();
  // Snapshot route registers unconditionally with a getter so a post-init
  // snapshotter is picked up on the next request without re-registration.
  // When the getter returns null, the route serves a synthetic
  // `is_initialized: false` snapshot. The cwd argument lets the route
  // detect brownfield-vs-pure-greenfield once at registration.
  registerSnapshotRoute(app, () => snapshotter, cwd);
  // v2.3: read-only CLI parity routes. Each one mirrors a `swt` verb and
  // serves data the dashboard's parity panels render. They register here
  // (after snapshot, before init/command) so a greenfield daemon still
  // exposes them — config defaults, doctor, detect-phase, update check,
  // and command registry all work without `.swt-planning/`.
  registerConfigRoute(app, cwd, bus);
  // Phase 3: vendor-select panel — GET (secret-free snapshot) + POST (keychain write, X-SWT-Credential-Write gated).
  registerProviderAuthRoute(app, cwd, bus);
  registerProviderAuthOAuthRoute(app, cwd, bus); // Phase 4: OAuth login flow — POST /oauth/start + /oauth/code, OAuthLoginCallbacks bridged to oauth.* SSE events.
  // alpha.35: TopBar Model dropdown — projects Pi's ModelRegistry.getAll() into ModelInfo for the wire.
  registerModelsRoute(app);
  registerDoctorRoute(app, cwd);
  registerDetectPhaseRoute(app, cwd);
  registerUpdateRoute(app);
  registerCommandsRoute(app);
  // User Notes: a freeform per-project scratchpad backed by
  // `<cwd>/.swt-planning/USER_NOTES.md`. Registers unconditionally
  // (cwd-relative, greenfield-tolerant) alongside the other tools routes.
  // Deliberately isolated — the POST route publishes no SSE event.
  registerUserNotesRoute(app, cwd, bus);
  // Artifact-family routes register unconditionally with getter closures so a
  // post-init projectRoot (assigned by the greenfield watcher above) is picked
  // up on the next request without re-registration. Mirrors the snapshot route's
  // `() => snapshotter` pattern. Pre-init: each route returns 503 with body.
  registerArtifactRoute(app, () => projectRoot);
  registerArtifactHistoryRoute(app, () => projectRoot);
  registerArtifactDiffRoute(app, () => projectRoot);
  registerUatCheckpointRoute(app, () => projectRoot);
  // Plan 03-04 PR-27: Worktrees panel SSE route. Registers unconditionally
  // with a nullable projectRoot — the route returns 503 when projectRoot is
  // null (greenfield daemon) so the client can still discover the endpoint.
  registerWorktreesRoute(app, projectRoot);
  // Plan 04-01 PR-33: cache-hit ratio SSE route. Plan 04-02 T5 swapped the
  // `() => null` placeholder for a file-backed meter that reads the latest
  // `.swt-planning/.metrics/session-*.json` (written by methodology's
  // token-meter at plan 04-01 T3). Live updates flow through the
  // snapshotter's chokidar watch on .metrics/ (T2), so the meter's
  // subscribe() is a no-op — re-render is driven by snapshot deltas, not a
  // separate METER_UPDATED channel.
  registerCacheHitsRoute(
    app,
    createFileBackedMeterGetter(() => projectRoot),
  );
  // Plan 04-01 PR-35: Budget Gate SSE + POST routes. Plan 06-02 T3
  // replaces the prior `() => null` placeholder with a live BudgetGate
  // wired through `createLiveBudgetWiring` — the chokidar file-meter
  // adapter watches `.swt-planning/.metrics/` so spend pressure flows
  // through the gate in real time, and `budget.pause` / `budget.resume`
  // events translate to `.cook-controls/<sid>.pending` signal-file
  // writes for the cook orchestrator's existing boundary consumer.
  // Greenfield daemons without a projectRoot keep the null placeholder.
  let budgetWiring: BudgetWiring | null = null;
  if (projectRoot !== null) {
    budgetWiring = createLiveBudgetWiring({ projectRoot });
    registerBudgetRoute(app, budgetWiring.getGate);
  } else {
    registerBudgetRoute(app, () => null);
  }
  // Plan 04-01 PR-37: TPAC history SSE route. Reads
  // <projectRoot>/.swt-planning/.tpac/*.json on connect; chokidar-
  // watches for new reports. Empty state when projectRoot is null OR
  // .tpac/ is missing/empty.
  registerTpacRoute(app, projectRoot);
  // Plan 05-01 PR-43: per-provider cost panel SSE route. Symmetric
  // with cache-hits + budget routes — registers with a `() => null`
  // placeholder until the methodology layer wires a live meter.
  registerProviderCostRoute(app, () => null);
  // Plan 02-01 T1 (milestone 08, Phase 02): instantiate Phase 01's
  // local rolling-usage aggregator + mount `GET /api/usage-rollup`.
  // The aggregator subscribes to the EventBus on construction
  // (cook.agent_result fan-in → snapshot.usage_rollup partial) and
  // owns its own cleanup via `usageAggregator.close()`, called in
  // `createServer`'s close callback below.
  const usageAggregator = createUsageAggregator({ bus });
  app.route('/', createUsageRollupRoute({ aggregator: usageAggregator }));
  // Plan 01-05 (Phase 1): swt:askUser dashboard-mediated prompt routes.
  // POST /api/prompts/publish (orchestrator → dashboard),
  // POST /api/prompts/:id/respond (dashboard → orchestrator response),
  // GET /api/prompts/pending (replay for reconnects). All in-memory; no
  // file IO. Mirrors registerUatCheckpointRoute's mount pattern.
  registerPromptsRoute(app, bus);
  registerInitRoute(app, {
    projectRoot: cwd,
    onInitialized: (root) => {
      // After a successful init, spin up a snapshotter on the new root so
      // subsequent /api/snapshot polls + SSE state.changed events flow.
      if (snapshotter) return; // someone else got there first
      snapshotter = createSnapshotter({ projectRoot: root, bus });
      projectRoot = root;
    },
    // Read the snapshot AFTER onInitialized has spun up the snapshotter so
    // the route can include it inline in the response (B-08 / S-02).
    getSnapshot: () => snapshotter?.current() ?? null,
    // Plan 02-01 T3 — bus + spawnFn wire the Lead-subprocess lifecycle.
    // The bus carries init.start / init.complete / init.error to the SPA;
    // spawnFn defaults to node:child_process.spawn at the route's use-site
    // because passing the import here keeps the production wiring
    // explicit (and tests register WITHOUT spawnFn to verify graceful
    // degradation).
    bus,
    spawnFn: nodeSpawn,
  });
  registerCommandRoute(app, cwd);
  // Plan 04-02 T3 — REQ-17 cook control surface. Cook is intentionally NOT
  // routed through /api/command's allowlist: it spawns a long-lived agent
  // loop with its own session lifecycle, so it gets its own
  // POST /api/cook/start (detached spawn) + POST /api/cook/:sessionId/control
  // (signal-file via writePendingSignal).
  registerCookStartRoute(app, { projectRoot: cwd, bus });
  registerCookControlRoute(app, { projectRoot: cwd });
  // Plan 02-01 (milestone 13, Phase 02) — POST /api/cook/respond:
  // cook-aware wrapper over the existing prompts response logic. Validates
  // `cook_session_id` correlation BEFORE delegating to the same
  // bus.publish(prompt.response) + dropPendingPrompt() in-process logic
  // that `POST /api/prompts/:id/respond` runs. Reuses the prompt.response
  // event — no parallel cook.user_responded variant.
  registerCookRespondRoute(app, bus);
  // Plan 01-03 (milestone 12, Phase 01) — POST /api/chat Free-talk Mode
  // route. The factory mirrors the cook-start / init pattern: a
  // self-contained Hono sub-app mounted at /api/chat. The registry holds
  // SwtSession handles across turns so multi-turn POSTs with the same
  // chat_session_id reuse the same Pi AgentSession (history accumulates
  // natively via SessionManager.inMemory — Scout RESEARCH §Q3).
  app.route(
    '/api/chat',
    createChatRoute({
      projectRoot: cwd,
      bus,
      registry: chatRegistry,
    }),
  );
  // Phase 6 plan 06-06 T3: the /api/vibe + /api/vibe/:session_id/reply
  // shim layer (Phase 4 R7 carry-forward through plan 06-03 carve-out) was
  // removed. `swt cook` via POST /api/cook/start is the canonical v3 entry;
  // askUser responses flow through POST /api/prompts/:id/respond. Any
  // request hitting /api/vibe* now returns 404 from the Hono catch-all.
  // Regression test: packages/dashboard/test/vibe-shim-removed.test.ts.
  registerSpaRoutes(app);
  return { app, bus, snapshotter, projectRoot, budgetWiring, usageAggregator, chatRegistry };
}

/**
 * Serve the bundled SPA (`packages/dashboard/dist/client/`) at `GET /` and
 * `GET /assets/*`. Without this, a browser hitting the daemon's root URL
 * gets 404 because the API routes don't match `/`. The client dir lives
 * adjacent to the daemon bundle in the published tarball:
 *
 *   <pkg>/dist/dashboard-server.mjs        ← this file at runtime
 *   <pkg>/packages/dashboard/dist/client/  ← SPA static assets
 *
 * Resolution probes a few candidate paths so the same code works for the
 * tsup'd published bundle, the in-repo dist, and a user's local
 * `pnpm --filter @swt-labs/dashboard build` output.
 */
function registerSpaRoutes(app: Hono): void {
  const here = (() => {
    try {
      return fileURLToPath(import.meta.url);
    } catch {
      return process.cwd();
    }
  })();
  const serverDir = dirname(here);
  const candidates = [
    // Published tarball: dist/dashboard-server.mjs → ../packages/dashboard/dist/client
    resolve(serverDir, '..', 'packages', 'dashboard', 'dist', 'client'),
    // In-repo dev: packages/dashboard/src/server/index.ts → ../../dist/client
    resolve(serverDir, '..', '..', 'dist', 'client'),
    // Cwd fallback
    resolve(process.cwd(), 'packages', 'dashboard', 'dist', 'client'),
  ];
  const clientDir = candidates.find((p) => existsSync(p));
  if (!clientDir) return;

  app.use(
    '/*',
    serveStatic({
      root: clientDir,
      // Hono's serveStatic uses paths relative to `root`; `rewriteRequestPath`
      // strips a leading `/` so `GET /assets/foo.js` resolves under `root`.
      rewriteRequestPath: (path) => path.replace(/^\/+/, '/'),
    }),
  );

  // SPA fallback — for any non-API GET (deep links, refreshes), hand back
  // index.html so the client-side router takes over. Critically, `/api/*`
  // is excluded so a missing API route returns a real JSON 404 rather than
  // HTML (a v1.6.2 regression that masked the real DISCONNECTED bug).
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    const indexPath = resolve(clientDir, 'index.html');
    if (!existsSync(indexPath)) return c.notFound();
    const { readFileSync } = await import('node:fs');
    return c.html(readFileSync(indexPath, 'utf8'));
  });
}

export async function createServer(options: CreateServerOptions = {}): Promise<DashboardServer> {
  const portFromEnv =
    process.env['SWT_DASHBOARD_PORT'] !== undefined && process.env['SWT_DASHBOARD_PORT'] !== ''
      ? Number.parseInt(process.env['SWT_DASHBOARD_PORT'], 10)
      : Number.parseInt(process.env['PORT'] ?? String(DEFAULT_PORT), 10);
  const port = options.port ?? portFromEnv;
  const hostname =
    options.hostname ??
    (process.env['SWT_DASHBOARD_HOST'] && process.env['SWT_DASHBOARD_HOST'].length > 0
      ? process.env['SWT_DASHBOARD_HOST']
      : LOOPBACK);
  const allowPublic =
    options.allowPublic ??
    (process.env['SWT_DASHBOARD_UNSAFE_PUBLIC'] === '1' ||
      process.env['SWT_UNSAFE_PUBLIC'] === '1');

  const startedAt = Date.now();

  let projectRoot: string | undefined = options.projectRoot;
  if (projectRoot === undefined && !options.skipSnapshotter) {
    try {
      projectRoot = findProjectRoot();
    } catch {
      projectRoot = undefined;
    }
  }

  // Plan 06-03 T4 (Phase 4 R4) — resolve the dashboard token before
  // binding. Auth is enabled when (a) explicitly requested via
  // `options.authEnabled`, OR (b) `SWT_DASHBOARD_TOKEN` env var is set.
  // The binding-guard relaxes its loopback-only restriction when auth
  // is installed (fail-closed otherwise).
  const authEnabled =
    options.authEnabled === true ||
    (process.env['SWT_DASHBOARD_TOKEN'] !== undefined &&
      process.env['SWT_DASHBOARD_TOKEN'].length > 0);
  let authToken: string | undefined;
  if (authEnabled) {
    authToken = resolveDashboardToken(projectRoot !== undefined ? { projectRoot } : {});
  }

  assertSafeBinding({
    host: hostname,
    unsafePublic: allowPublic,
    authMiddlewareInstalled: authEnabled,
  });

  // Plan 04-05 T1 (R7): the v2 `agentFactory` plumbing was gutted alongside
  // the rest of the `packages/dashboard/src/server/vibe/` subtree. The
  // only supported orchestrator entry is `swt cook` via /api/cook/start.
  const { app, bus, snapshotter, budgetWiring, usageAggregator, chatRegistry } = createApp({
    startedAt,
    ...(projectRoot && !options.skipSnapshotter ? { projectRoot } : {}),
    ...(authToken !== undefined ? { authToken } : {}),
  });

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname, port }, () => resolve(s));
  });

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    app,
    server,
    bus,
    snapshotter,
    projectRoot: projectRoot ?? null,
    port: boundPort,
    hostname,
    close: async () => {
      if (budgetWiring !== null) {
        await budgetWiring.dispose();
      }
      // Plan 02-01 T1: tear down the local usage aggregator's bus
      // subscription. Synchronous; adjacent to budgetWiring.dispose().
      usageAggregator.close();
      // Plan 01-03 (milestone 12, Phase 01): stop the chat-session TTL
      // sweep + dispose any still-registered SwtSession handles so Pi
      // releases its underlying resources at daemon shutdown.
      chatRegistry.close();
      if (snapshotter) await snapshotter.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

const isDirectInvocation = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const here = new URL(import.meta.url).pathname;
    return entry === here || entry.endsWith('/dashboard-server.mjs');
  } catch {
    return false;
  }
};

if (isDirectInvocation()) {
  createServer()
    .then((s) => {
      // The CLI watches for "Listening on http://..." on the daemon's stderr,
      // so log the ready line to stderr; stdout is left clean for any future
      // structured outputs.
      process.stderr.write(`swt-dashboard Listening on http://${s.hostname}:${s.port}\n`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`swt-dashboard failed to start: ${message}\n`);
      process.exit(1);
    });
}
