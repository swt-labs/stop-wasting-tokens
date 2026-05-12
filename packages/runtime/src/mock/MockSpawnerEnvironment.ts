import type { AgentSpawner, SpawnerEnvironment, SpawnerProbeResult } from '@swt-labs/core';

/**
 * PR-02 stub upgrade. Probe now reports `available: true, name: 'pi-runtime-mock'`
 * — runtime/ exists, Pi is type-resolvable, basic typechecks land. `getSpawner()`
 * still throws because actual dispatching lands in PR-03 (orchestration/ with
 * `PiSpawnerEnvironment` + the sequential `Dispatcher`).
 *
 * CLI consumers can call `probe()` to confirm the v3 runtime is wired (`swt doctor`
 * stops printing the PR-01b "PR-02 not yet merged" warning once this lands); calling
 * `getSpawner()` still surfaces a clear pointer to PR-03 if anything tries to spawn.
 */
export class MockSpawnerEnvironment implements SpawnerEnvironment {
  async probe(): Promise<SpawnerProbeResult> {
    return {
      available: true,
      name: 'pi-runtime-mock',
      version: '0.0.0-mock',
    };
  }

  async getSpawner(): Promise<AgentSpawner> {
    throw new Error(
      'MockSpawnerEnvironment (PR-02): probe() succeeds but real spawning is M1 PR-03 ' +
        '(PiSpawnerEnvironment in @swt-labs/orchestration). `swt vibe` remains non-functional ' +
        'between PR-02 and PR-03.',
    );
  }
}
