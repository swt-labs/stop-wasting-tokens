import type { AgentSpawner } from './AgentSpawner.js';

/**
 * Result of probing the runtime environment for spawner availability.
 *
 * `name` is a human-readable label (e.g. "codex", "pi-runtime", "claude-code"); it is
 * informational only — CLI consumers should not branch on its value to choose code paths
 * (use `available` for the boolean gate).
 *
 * `reason` populates only when `available === false` and explains why (e.g.,
 * "PR-02 not yet merged — runtime adapter not present", "pi peerDep missing").
 */
export interface SpawnerProbeResult {
  readonly available: boolean;
  readonly name: string;
  readonly version?: string;
  readonly reason?: string;
}

/**
 * The CLI consumes runtime spawners through this abstraction so `vibe.ts` and
 * `doctor.ts` never source-import from any `@swt-labs/*-driver` package.
 *
 * Concrete implementations:
 *   - PR-01b: stub `MockSpawnerEnvironment` wired in `cli/main.ts` — `probe()` returns
 *     `{available: false, reason: 'PR-02 not yet merged'}`; `getSpawner()` throws.
 *   - PR-02: real `MockSpawnerEnvironment` in `packages/runtime/src/mock/` — probe returns
 *     `available: true, name: 'pi-runtime-mock'`; `getSpawner()` still throws (real spawn in PR-03).
 *   - PR-03: `PiSpawnerEnvironment` in `packages/orchestration/` — probe verifies Pi
 *     peerDep is resolved; `getSpawner()` returns an `AgentSpawner` backed by the
 *     orchestration dispatcher.
 */
export interface SpawnerEnvironment {
  probe(): Promise<SpawnerProbeResult>;
  getSpawner(): Promise<AgentSpawner>;
}
