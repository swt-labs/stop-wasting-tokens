import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchHandler, type WatchHandle, type WatchRenderer } from '../../src/commands/watch.js';
import type { WatchViewModel } from '../../src/watch/state.js';
import { StringStream } from '../_helpers.js';

let tempCwd: string;

beforeEach(() => {
  tempCwd = mkdtempSync(join(tmpdir(), 'swt-watch-'));
});

afterEach(() => {
  rmSync(tempCwd, { recursive: true, force: true });
});

function stagePlanningDir(root: string): void {
  const planningDir = join(root, '.swt-planning');
  const phaseDir = join(planningDir, 'phases', '01-test');
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(join(planningDir, 'PROJECT.md'), '# my-project\n\nA test project.\n');
  writeFileSync(join(planningDir, 'config.json'), JSON.stringify({}));
  writeFileSync(
    join(planningDir, 'STATE.md'),
    '# State\n\n**Milestone:** v1.0 release\n\n## Current Phase\n\n01-test\n',
  );
  writeFileSync(
    join(planningDir, 'ROADMAP.md'),
    '# Roadmap\n\n## Phases\n\n- [ ] 01: test (`01-test`)\n',
  );
  writeFileSync(
    join(phaseDir, '01-01-PLAN.md'),
    `---\nphase: '01'\nplan: '01'\ntitle: t\nwave: 1\ndepends_on: []\nfiles_modified: []\n---\n# Plan\n`,
  );
}

describe('watchHandler', () => {
  it('returns USAGE_ERROR when no .swt-planning exists', async () => {
    const handler = watchHandler();
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await handler(
      { command: 'watch', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout, stderr },
    );

    expect(exit).toBe(1);
    expect(stderr.text()).toContain('No SWT project here');
  });

  it('renders the dashboard with the staged snapshot', async () => {
    stagePlanningDir(tempCwd);

    let captured: WatchViewModel | undefined;
    const handler = watchHandler({
      oneShot: true,
      readRecentActivity: () => [
        { hash: 'abc1234', subject: 'init', date: '2026-05-07T10:00:00Z' },
      ],
      render: (state): WatchRenderer => {
        captured = state;
        return {
          rerender: (s) => {
            captured = s;
          },
          unmount: () => undefined,
        };
      },
    });
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await handler(
      { command: 'watch', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout, stderr },
    );

    expect(exit).toBe(0);
    expect(captured).toBeDefined();
    expect(captured!.project).toBe('my-project');
    expect(captured!.milestone).toBe('v1.0 release');
    expect(captured!.phase.number).toBe('01');
    expect(captured!.phase.slug).toBe('01-test');
    expect(captured!.activity).toEqual([
      { hash: 'abc1234', subject: 'init', date: '2026-05-07T10:00:00Z' },
    ]);
  });

  it('SIGINT teardown calls watcher.close + renderer.unmount and resolves with exit 0', async () => {
    stagePlanningDir(tempCwd);

    const closeFn = vi.fn().mockResolvedValue(undefined);
    const unmountFn = vi.fn();
    const watcherFactory = (_path: string, _onChange: () => void): WatchHandle => ({
      close: closeFn,
    });
    const renderFactory = (_state: WatchViewModel): WatchRenderer => ({
      rerender: () => undefined,
      unmount: unmountFn,
    });

    const handler = watchHandler({
      readRecentActivity: () => [],
      watcherFactory,
      render: renderFactory,
    });
    const stdout = new StringStream();
    const stderr = new StringStream();

    const initialListeners = process.listenerCount('SIGINT');

    const exitPromise = handler(
      { command: 'watch', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout, stderr },
    );

    // Wait for the handler to register its SIGINT listener (up to 1s).
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && process.listenerCount('SIGINT') === initialListeners) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    process.emit('SIGINT');

    const exit = await exitPromise;

    expect(exit).toBe(0);
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(unmountFn).toHaveBeenCalledTimes(1);
  });
});
