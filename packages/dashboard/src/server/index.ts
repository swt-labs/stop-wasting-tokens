import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { createEventBus, type EventBus } from './event-bus.js';
import { assertSafeBinding } from './lib/binding-guard.js';
import { findProjectRoot } from './lib/find-project-root.js';
import { registerArtifactRoute } from './routes/artifact.js';
import { registerCommandRoute } from './routes/command.js';
import { registerDebugEmitRoute } from './routes/debug-emit.js';
import { registerEventsRoute } from './routes/events.js';
import { registerHealthRoute } from './routes/health.js';
import { registerInitRoute } from './routes/init.js';
import { registerSnapshotRoute } from './routes/snapshot.js';
import { registerUatCheckpointRoute } from './routes/uat-checkpoint.js';
import { createSnapshotter, type Snapshotter } from './snapshot/snapshotter.js';

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
}

const DEFAULT_PORT = 54321;
const LOOPBACK = '127.0.0.1';

export function createApp(
  opts: {
    bus?: EventBus;
    startedAt?: number;
    projectRoot?: string;
    snapshotter?: Snapshotter;
  } = {},
): { app: Hono; bus: EventBus; snapshotter: Snapshotter | null; projectRoot: string | null } {
  const bus = opts.bus ?? createEventBus();
  const startedAt = opts.startedAt ?? Date.now();
  const app = new Hono();
  registerHealthRoute(app, startedAt);
  registerEventsRoute(app, bus);
  registerDebugEmitRoute(app, bus);

  let snapshotter: Snapshotter | null = opts.snapshotter ?? null;
  let projectRoot: string | null = opts.projectRoot ?? null;
  if (snapshotter && !projectRoot) {
    // best-effort: snapshotter was injected without explicit root; skip routes that need a root
  }
  if (projectRoot && !snapshotter) {
    snapshotter = createSnapshotter({ projectRoot, bus });
  }
  // Snapshot route registers unconditionally with a getter so a post-init
  // snapshotter is picked up on the next request without re-registration.
  // When the getter returns null, the route serves a synthetic
  // `is_initialized: false` snapshot.
  registerSnapshotRoute(app, () => snapshotter);
  if (projectRoot) {
    registerArtifactRoute(app, projectRoot);
    registerUatCheckpointRoute(app, projectRoot);
  }
  // Init + command always register — they're how a greenfield user goes from
  // "no .swt-planning/" to a connected dashboard, and how power users invoke
  // arbitrary `swt` verbs from the TopBar input.
  const cwd = projectRoot ?? process.cwd();
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
  registerSpaRoutes(app);
  return { app, bus, snapshotter, projectRoot };
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

  const { app, bus, snapshotter } = createApp({
    startedAt,
    ...(projectRoot && !options.skipSnapshotter ? { projectRoot } : {}),
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
