import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import chokidar from 'chokidar';
import { render } from 'ink';
import React from 'react';

import { detectPhase } from '@swt-labs/methodology';

import { Dashboard } from '../watch/dashboard.js';
import {
  computeWatchState,
  type RecentCommit,
  type WatchSnapshot,
  type WatchViewModel,
} from '../watch/state.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export interface WatchHandle {
  close(): Promise<void>;
}

export interface WatchRenderer {
  rerender: (state: WatchViewModel) => void;
  unmount: () => void;
}

export interface WatchOptions {
  /** Inject a renderer (default: real Ink render of <Dashboard />). */
  readonly render?: (state: WatchViewModel) => WatchRenderer;
  /** Inject a watcher factory (default: chokidar.watch). Tests use a no-op stub. */
  readonly watcherFactory?: (path: string, onChange: () => void) => WatchHandle;
  /** Inject a recent-commits resolver. Default reads `git log -3` synchronously. */
  readonly readRecentActivity?: (cwd: string) => readonly RecentCommit[];
  /** Test seam: skip the long-running render loop and resolve after first render. */
  readonly oneShot?: boolean;
}

export function watchHandler(opts: WatchOptions = {}): CommandHandler {
  return async (_parsed, io: CommandIO): Promise<ExitCode> => {
    const planningDir = join(io.cwd, '.swt-planning');
    if (!existsSync(planningDir)) {
      io.stderr.write(
        'No SWT project here. Run `swt init` to bootstrap (.swt-planning/ is missing).\n',
      );
      return EXIT.USAGE_ERROR;
    }

    const phaseDetect = await detectPhase({ cwd: io.cwd });
    const project = readProjectName(planningDir);
    const milestone = readMilestoneName(planningDir);
    const readActivity = opts.readRecentActivity ?? readRecentActivityDefault;
    const recentActivity = readActivity(io.cwd);

    const initialSnapshot: WatchSnapshot = {
      phaseDetect,
      recentActivity,
      project,
      milestone,
    };
    const initialState = computeWatchState(initialSnapshot);

    const renderer = (opts.render ?? defaultRender)(initialState);

    if (opts.oneShot === true) {
      renderer.unmount();
      return EXIT.SUCCESS;
    }

    const handle = (opts.watcherFactory ?? defaultWatcherFactory)(planningDir, async () => {
      try {
        const fresh = await detectPhase({ cwd: io.cwd });
        const next: WatchSnapshot = {
          phaseDetect: fresh,
          recentActivity: readActivity(io.cwd),
          project,
          milestone,
        };
        renderer.rerender(computeWatchState(next));
      } catch {
        // Swallow errors during re-detect — keep the dashboard responsive.
      }
    });

    return new Promise<ExitCode>((resolve) => {
      const cleanup = async (): Promise<void> => {
        process.off('SIGINT', cleanup);
        process.off('SIGTERM', cleanup);
        await handle.close();
        renderer.unmount();
        resolve(EXIT.SUCCESS);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
  };
}

function readProjectName(planningDir: string): string {
  try {
    const raw = readFileSync(join(planningDir, 'PROJECT.md'), 'utf8');
    const match = /^#\s+(.+)$/m.exec(raw);
    return match?.[1]?.trim() ?? 'unknown project';
  } catch {
    return 'unknown project';
  }
}

function readMilestoneName(planningDir: string): string {
  try {
    const raw = readFileSync(join(planningDir, 'STATE.md'), 'utf8');
    const match = /^\*\*Milestone:\*\*\s+(.+)$/m.exec(raw);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function readRecentActivityDefault(cwd: string): readonly RecentCommit[] {
  try {
    const out = execSync('git log -3 --pretty=format:%H%x09%s%x09%cI', {
      cwd,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash = '', subject = '', date = ''] = line.split('\t');
        return { hash, subject, date };
      });
  } catch {
    return [];
  }
}

function defaultRender(initialState: WatchViewModel): WatchRenderer {
  const instance = render(React.createElement(Dashboard, { state: initialState }));
  return {
    rerender: (state) => {
      instance.rerender(React.createElement(Dashboard, { state }));
    },
    unmount: () => instance.unmount(),
  };
}

function defaultWatcherFactory(path: string, onChange: () => void): WatchHandle {
  const watcher = chokidar.watch(path, {
    ignoreInitial: true,
    persistent: true,
  });

  let pending: NodeJS.Timeout | null = null;
  const debouncedFire = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      onChange();
    }, 200);
  };

  watcher.on('add', debouncedFire);
  watcher.on('change', debouncedFire);
  watcher.on('unlink', debouncedFire);

  return {
    async close(): Promise<void> {
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
      await watcher.close();
    },
  };
}

// Provide a no-options entry for the registry.
export const defaultWatchHandler: CommandHandler = watchHandler();
