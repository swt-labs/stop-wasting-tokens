import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vibeHandler } from '../../src/commands/vibe.js';
import { StringStream } from '../_helpers.js';

/**
 * v3.0.0-alpha.4 collapsed the old `init-redirect` route into `bootstrap`,
 * so an empty cwd no longer dead-ends with USAGE_ERROR — it flows on to the
 * spawner probe (the next early-exit), then into the bootstrap handler.
 * This test pins the new behavior: the route banner is `bootstrap`, and
 * without a SpawnerEnvironment wired the handler returns RUNTIME_ERROR
 * with the spawner-missing diagnostic.
 *
 * End-to-end vibe coverage (spawnerEnv wired, discussion engine reached)
 * is M2 PR-15 / live-Pi territory — tracked separately.
 */
describe('vibeHandler — bootstrap route on empty cwd', () => {
  let tempCwd: string;

  beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'swt-vibe-cwd-'));
  });

  afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
  });

  it('routes to bootstrap and exits RUNTIME_ERROR without a SpawnerEnvironment wired', async () => {
    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = await vibeHandler(
      { verb: 'vibe', positionals: [], flags: {} },
      { cwd: tempCwd, stdout, stderr },
    );
    expect(stdout.text()).toContain('◆ Route: bootstrap');
    expect(exit).toBe(3); // EXIT.RUNTIME_ERROR
    expect(stderr.text()).toContain('no SpawnerEnvironment');
  });
});
