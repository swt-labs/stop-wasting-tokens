import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';

import { createEventBus, type EventBus } from './event-bus.js';
import { assertSafeBinding } from './lib/binding-guard.js';
import { findProjectRoot } from './lib/find-project-root.js';
import { registerArtifactRoute } from './routes/artifact.js';
import { registerDebugEmitRoute } from './routes/debug-emit.js';
import { registerEventsRoute } from './routes/events.js';
import { registerHealthRoute } from './routes/health.js';
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
  if (snapshotter) {
    registerSnapshotRoute(app, snapshotter);
  }
  if (projectRoot) {
    registerArtifactRoute(app, projectRoot);
    registerUatCheckpointRoute(app, projectRoot);
  }
  return { app, bus, snapshotter, projectRoot };
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
