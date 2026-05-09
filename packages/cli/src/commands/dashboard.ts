import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT, type ExitCode } from '../exit-codes.js';
import { assertSafeBinding, UnsafeBindingError } from '../lib/binding-guard.js';
import { openBrowser, shouldAutoOpen } from '../lib/open-browser.js';
import { pickPort } from '../lib/pick-port.js';
import type { CommandHandler, CommandIO } from '../router.js';

const PORT_RANGE = { start: 54320, end: 54420 } as const;
const READY_LINE_RE = /Listening on http:\/\/[^/\s]+/i;
const SHUTDOWN_TIMEOUT_MS = 5000;

interface DashboardFlags {
  readonly port: number | null;
  readonly host: string;
  readonly unsafePublic: boolean;
  readonly noOpen: boolean;
  readonly debug: boolean;
}

function parseFlags(parsed: {
  flags: Readonly<Record<string, string | boolean | undefined>>;
}): DashboardFlags {
  const portRaw = parsed.flags.port;
  const port = typeof portRaw === 'string' ? Number.parseInt(portRaw, 10) : null;
  const hostRaw = parsed.flags.host;
  const host = typeof hostRaw === 'string' && hostRaw.length > 0 ? hostRaw : '127.0.0.1';
  return {
    port: typeof port === 'number' && Number.isFinite(port) ? port : null,
    host,
    unsafePublic: parsed.flags['unsafe-public'] === true,
    noOpen: parsed.flags['no-open'] === true,
    debug: parsed.flags.debug === true,
  };
}

function resolveDaemonEntry(cwd: string): { script: string; mode: 'built' | 'src' } | null {
  const built = join(cwd, 'dist', 'dashboard-server.mjs');
  if (existsSync(built)) return { script: built, mode: 'built' };
  // Fallback: try repo-local path (dev usage from monorepo root)
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const repoRoot = realpathSync(join(here, '..', '..', '..', '..'));
    const repoSrc = join(repoRoot, 'packages', 'dashboard', 'src', 'server', 'main.ts');
    if (existsSync(repoSrc)) return { script: repoSrc, mode: 'src' };
  } catch {
    /* ignore */
  }
  return null;
}

function spawnDaemon(
  entry: { script: string; mode: 'built' | 'src' },
  port: number,
  host: string,
  unsafePublic: boolean,
  debug: boolean,
): ChildProcess {
  const env = {
    ...process.env,
    SWT_DASHBOARD_PORT: String(port),
    SWT_DASHBOARD_HOST: host,
    ...(unsafePublic ? { SWT_DASHBOARD_UNSAFE_PUBLIC: '1' } : {}),
  };
  const stdio: StdioOptions = debug ? ['inherit', 'inherit', 'pipe'] : ['ignore', 'pipe', 'pipe'];
  if (entry.mode === 'src') {
    return spawn('node', ['--import', 'tsx/esm', entry.script], { env, stdio });
  }
  return spawn('node', [entry.script], { env, stdio });
}

async function waitForReady(child: ChildProcess, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      // Mirror to our stderr so debug streams pass through.
      process.stderr.write(chunk);
      const match = READY_LINE_RE.exec(buffer);
      if (match) {
        cleanup();
        resolveReady(match[0]);
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Daemon exited before ready (code=${code ?? 'null'})`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Daemon ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
    }
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function gracefulShutdown(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
      resolveExit();
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

export const dashboardHandler: CommandHandler = async (
  parsed,
  io: CommandIO,
): Promise<ExitCode> => {
  const flags = parseFlags(parsed);

  try {
    assertSafeBinding({ host: flags.host, unsafePublic: flags.unsafePublic });
  } catch (err) {
    if (err instanceof UnsafeBindingError) {
      io.stderr.write(`swt dashboard: ${err.message}\n`);
      return EXIT.USAGE_ERROR;
    }
    throw err;
  }

  const port =
    flags.port ??
    (await pickPort({ start: PORT_RANGE.start, end: PORT_RANGE.end, host: flags.host }));

  const entry = resolveDaemonEntry(io.cwd);
  if (!entry) {
    io.stderr.write(
      'swt dashboard: could not find dashboard server bundle (dist/dashboard-server.mjs).\n' +
        'Run `pnpm build` from the repo root or invoke from a workspace with a built dashboard.\n',
    );
    return EXIT.USAGE_ERROR;
  }

  const child = spawnDaemon(entry, port, flags.host, flags.unsafePublic, flags.debug);

  let readyLine: string;
  try {
    readyLine = await waitForReady(child);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`swt dashboard: ${message}\n`);
    await gracefulShutdown(child);
    return EXIT.RUNTIME_ERROR;
  }

  const url = readyLine.replace(/^.*?(http:\/\/[^/\s]+).*/i, '$1');
  io.stdout.write(`Dashboard ${readyLine}\nAddress: ${url}/\n`);

  const stdoutIsTty = Boolean((io.stdout as { isTTY?: boolean }).isTTY ?? true);
  const wantOpen = !flags.noOpen && shouldAutoOpen(process.env, stdoutIsTty);
  if (wantOpen) {
    try {
      await openBrowser(`${url}/`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      io.stderr.write(`swt dashboard: auto-open failed (${message}). Visit ${url}/ manually.\n`);
    }
  }

  return new Promise<ExitCode>((resolveExit) => {
    const onSignal = (): void => {
      io.stderr.write('\nswt dashboard: shutting down…\n');
      void gracefulShutdown(child).then(() => resolveExit(EXIT.SUCCESS));
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    child.once('exit', (code) => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolveExit(code === 0 ? EXIT.SUCCESS : EXIT.RUNTIME_ERROR);
    });
  });
};

export function registerDashboard(registry: {
  register: (spec: {
    name: string;
    description: string;
    usage?: string;
    handler: CommandHandler;
  }) => unknown;
}): void {
  registry.register({
    name: 'dashboard',
    usage: '[--port N] [--host H] [--unsafe-public] [--no-open] [--debug]',
    description: 'Boot the localhost dashboard daemon and open it in the default browser',
    handler: dashboardHandler,
  });
}

export const __test = { parseFlags, resolveDaemonEntry };
// Resolve unused-export hint when bundled
void resolve;
