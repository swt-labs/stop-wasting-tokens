import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import chokidar from 'chokidar';
import { Hono } from 'hono';

import { createEventBus, type EventBus } from './event-bus.js';
import { assertSafeBinding } from './lib/binding-guard.js';
import { securityHeadersMiddleware } from './lib/csp.js';
import { findProjectRoot } from './lib/find-project-root.js';
import { registerArtifactRoute } from './routes/artifact.js';
import { registerCommandRoute } from './routes/command.js';
import { registerCommandsRoute } from './routes/commands.js';
import { registerConfigRoute } from './routes/config.js';
import { registerDebugEmitRoute } from './routes/debug-emit.js';
import { registerDetectPhaseRoute } from './routes/detect-phase.js';
import { registerDoctorRoute } from './routes/doctor.js';
import { registerEventsRoute } from './routes/events.js';
import { registerHealthRoute } from './routes/health.js';
import { registerInitRoute } from './routes/init.js';
import { registerSnapshotRoute } from './routes/snapshot.js';
import { registerUatCheckpointRoute } from './routes/uat-checkpoint.js';
import { registerUpdateRoute } from './routes/update.js';
import { registerVibeRoutes } from './routes/vibe.js';
import { registerWorktreesRoute } from './routes/worktrees.js';
import { createSnapshotter, type Snapshotter } from './snapshot/snapshotter.js';
import { CodexMethodologyAgent } from './vibe/codex-methodology-agent.js';
import type { MethodologyAgentFactory } from './vibe/methodology-agent.js';
import { createSessionRegistry, type SessionRegistry } from './vibe/session.js';

export interface DashboardServer {
  app: Hono;
  server: ServerType;
  bus: EventBus;
  snapshotter: Snapshotter | null;
  projectRoot: string | null;
  vibeRegistry: SessionRegistry;
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
   * Optional methodology-agent factory. When provided, `POST /api/vibe`
   * spawns a real agent loop (background async) for each new session.
   * v2.0 Phase 2 ships with no default — production wires
   * CodexMethodologyAgent in a follow-up plan; sessions stay idle until then.
   */
  agentFactory?: MethodologyAgentFactory;
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
     * Optional methodology-agent factory. When provided, `POST /api/vibe`
     * spawns a real agent loop (background async) for each new session.
     * When omitted (default), sessions stay idle — useful for unit tests
     * that exercise the wire format but don't need agent execution.
     */
    agentFactory?: MethodologyAgentFactory;
    /**
     * Tag for the agent backend, surfaced in `VibeStartResponse.agent_backend`.
     * Defaults: 'codex' when SWT_VIBE_AGENT=codex env var triggered the
     * factory; 'scripted' when caller passed an agentFactory; 'none' when
     * no factory was wired.
     */
    agentBackendTag?: 'none' | 'codex' | 'scripted';
  } = {},
): {
  app: Hono;
  bus: EventBus;
  snapshotter: Snapshotter | null;
  projectRoot: string | null;
  vibeRegistry: SessionRegistry;
} {
  const bus = opts.bus ?? createEventBus();
  const startedAt = opts.startedAt ?? Date.now();
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
  registerDoctorRoute(app, cwd);
  registerDetectPhaseRoute(app, cwd);
  registerUpdateRoute(app);
  registerCommandsRoute(app);
  if (projectRoot) {
    registerArtifactRoute(app, projectRoot);
    registerUatCheckpointRoute(app, projectRoot);
  }
  // Plan 03-04 PR-27: Worktrees panel SSE route. Registers unconditionally
  // with a nullable projectRoot — the route returns 503 when projectRoot is
  // null (greenfield daemon) so the client can still discover the endpoint.
  registerWorktreesRoute(app, projectRoot);
  registerInitRoute(
    app,
    cwd,
    (root) => {
      // After a successful init, spin up a snapshotter on the new root so
      // subsequent /api/snapshot polls + SSE state.changed events flow.
      if (snapshotter) return; // someone else got there first
      snapshotter = createSnapshotter({ projectRoot: root, bus });
      projectRoot = root;
    },
    // Read the snapshot AFTER onInitialized has spun up the snapshotter so
    // the route can include it inline in the response (B-08 / S-02).
    () => snapshotter?.current() ?? null,
  );
  registerCommandRoute(app, cwd);
  // v2.0 Phase 2: vibe session registry + routes. Disk-backed events JSONL
  // lives under {projectRoot}/.swt-planning/.vibe-sessions/. Falls back to
  // {cwd}/.swt-planning/ when no projectRoot is resolved (greenfield) so
  // the registry has a deterministic place to write logs from the moment
  // the daemon starts.
  const planningPath = join(projectRoot ?? cwd, '.swt-planning');
  const vibeRegistry = createSessionRegistry({ bus, planning_path: planningPath });
  registerVibeRoutes(app, {
    registry: vibeRegistry,
    project_root: projectRoot ?? cwd,
    ...(opts.agentFactory !== undefined ? { agentFactory: opts.agentFactory, bus } : {}),
    ...(opts.agentBackendTag !== undefined ? { agentBackendTag: opts.agentBackendTag } : {}),
  });
  registerSpaRoutes(app);
  return { app, bus, snapshotter, projectRoot, vibeRegistry };
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

  assertSafeBinding({ host: hostname, unsafePublic: allowPublic });

  const startedAt = Date.now();

  let projectRoot: string | undefined = options.projectRoot;
  if (projectRoot === undefined && !options.skipSnapshotter) {
    try {
      projectRoot = findProjectRoot();
    } catch {
      projectRoot = undefined;
    }
  }

  // v2.0: opt-in production agent factory. When `SWT_VIBE_AGENT=codex`
  // is set in the daemon's env, instantiate `CodexMethodologyAgent` for
  // each new vibe session. When unset (default), sessions stay idle —
  // matches the legacy 02-02/03 behavior so the production-default flip
  // doesn't ride along with this plan.
  let resolvedAgentFactory: MethodologyAgentFactory | undefined = options.agentFactory;
  let resolvedBackendTag: 'none' | 'codex' | 'scripted' = 'none';
  if (resolvedAgentFactory !== undefined) {
    // Caller-provided factory (test path) — tag scripted unless caller overrides.
    resolvedBackendTag = 'scripted';
  } else if (process.env['SWT_VIBE_AGENT'] === 'codex') {
    resolvedAgentFactory = ({ project_root }) =>
      new CodexMethodologyAgent({
        cwd: project_root,
      });
    resolvedBackendTag = 'codex';
  }

  const { app, bus, snapshotter, vibeRegistry } = createApp({
    startedAt,
    ...(projectRoot && !options.skipSnapshotter ? { projectRoot } : {}),
    ...(resolvedAgentFactory !== undefined ? { agentFactory: resolvedAgentFactory } : {}),
    agentBackendTag: resolvedBackendTag,
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
    vibeRegistry,
    port: boundPort,
    hostname,
    close: async () => {
      vibeRegistry.shutdown();
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
