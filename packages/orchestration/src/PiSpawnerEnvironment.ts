import type {
  AgentRole,
  AgentSpawner,
  AgentSpec,
  SpawnerEnvironment,
  SpawnerProbeResult,
  SpawnRequest,
  SpawnResult,
} from '@swt-labs/core';
import { probePiAvailable } from '@swt-labs/runtime';

import { createDispatcher } from './dispatcher.js';
import type { Dispatcher } from './types.js';

/**
 * Real-shape `SpawnerEnvironment` for v3 (third step on the PR-01b → PR-02 → PR-03
 * chain documented in `runtime/src/mock/MockSpawnerEnvironment.ts`).
 *
 * - `probe()` verifies Pi via `runtime.probePiAvailable()` — only the runtime
 *   layer imports `@earendil-works/pi-coding-agent` directly (Principle 1,
 *   §4.3). Orchestration delegates the probe so the layered-architecture
 *   boundary stays clean.
 * - `getSpawner()` returns an `AgentSpawner` backed by the sequential dispatcher
 *   (`dispatcher.ts`). PR-03's dispatcher returns synthetic success results, so the
 *   spawner returned here is structurally real but functionally a stub. M2 PR-12
 *   gives it teeth (real Lead/Dev dispatch).
 *
 * The methodology layer holds `AgentSpawner` references; this class is the seam
 * where Layer 2 (orchestration) hands one back to Layer 5 (cli). Per ADR-002,
 * `swt_report_result` will be the result-protocol bridge once Plan 01-02 PR-09
 * lands.
 */
export class PiSpawnerEnvironment implements SpawnerEnvironment {
  async probe(): Promise<SpawnerProbeResult> {
    const result = await probePiAvailable();
    if (result.available) {
      return {
        available: true,
        name: 'pi',
        ...(result.version !== undefined ? { version: result.version } : {}),
      };
    }
    return {
      available: false,
      name: 'pi',
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    };
  }

  async getSpawner(): Promise<AgentSpawner> {
    const dispatcher = createDispatcher();
    return makeAgentSpawnerFromDispatcher(dispatcher);
  }
}

/**
 * Bridge: `AgentSpawner` (methodology-facing) → `Dispatcher` (orchestration internal).
 *
 * - `installAgent(spec)` — no-op. Pi reads the user's `AGENTS.md` natively; v2's
 *   per-role TOML-writing is gone (per ADR-001 + ADR-005).
 * - `spawn(request)` — adapts `SpawnRequest` to `TaskBrief` and the resulting
 *   `TaskResult` back to `SpawnResult`. PR-03's dispatcher returns synthetic
 *   success; the spawner faithfully reports that.
 * - `removeAgent(role)` — no-op. Pi sessions are torn down by `session.dispose()`
 *   inside the dispatcher's `finally`.
 */
function makeAgentSpawnerFromDispatcher(dispatcher: Dispatcher): AgentSpawner {
  return {
    async installAgent(_spec: AgentSpec): Promise<void> {
      // Pi reads AGENTS.md natively; no per-role installation needed.
      return;
    },

    async spawn(request: SpawnRequest): Promise<SpawnResult> {
      const result = await dispatcher.dispatch({
        taskId: request.session_id,
        role: request.spec.role,
        cwd: request.cwd,
        promptContext: request.input,
      });

      return {
        role: request.spec.role,
        success: result.status === 'success',
        text: result.summary,
        ...(result.notes !== undefined ? { handoff: { notes: result.notes } } : {}),
        // PR-03's dispatcher does not produce usage data (no real Pi call).
        // PR-07 (token meter) feeds usage from the cassette-replay path.
      };
    },

    async removeAgent(_role: AgentRole): Promise<void> {
      // Pi session disposal happens inside the dispatcher; no driver state to clean.
      return;
    },
  };
}
