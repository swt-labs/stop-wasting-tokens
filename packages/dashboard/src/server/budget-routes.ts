/**
 * Plan 06-02 T3 — Live BudgetGate wiring for the dashboard server.
 *
 * Replaces the `() => null` placeholder previously passed to
 * `registerBudgetRoute` (Phase 4 PARITY-REPORT.md:95). Constructs a live
 * `BudgetGate` instance backed by a chokidar file-meter adapter
 * (`@swt-labs/methodology/meters`) watching `.swt-planning/.metrics/`.
 *
 * Responsibilities:
 *   1. Load the `budget` section from `.swt-planning/config.json` (or
 *      `.vbw-planning/config.json` in this repo's co-existence layout).
 *      Defaults match research §4.3: `{milestone_usd: 10,
 *      tier_downgrade_threshold: 0.7, pause_threshold: 0.95}`.
 *   2. Build the file-meter adapter against `<root>/.swt-planning/.metrics/`.
 *   3. Wire `createBudgetGate({config, meter: adapter})`.
 *   4. Subscribe a listener that translates `budget.pause` / `budget.resume`
 *      into cook-controls signal-file writes — `.swt-planning/.cook-controls/
 *      <sid>.pending` — so the cook orchestrator's existing
 *      `checkBoundarySignal` consumes them at the next inter-agent boundary
 *      (research §4.4 — same signal-file protocol as user-initiated pause).
 *   5. The session id is resolved from `.execution-state.json` (06-01 T2
 *      writes `session_id`). When no session is in flight the listener
 *      logs and skips — no signal is written.
 *
 * The route layer (`routes/budget.ts`) reads the live gate via a
 * `getGate: () => BudgetGate | null` closure, so the wiring + the SSE/POST
 * route surface stay decoupled. `createLiveBudgetWiring()` returns
 * `{getGate, dispose}` so the dashboard server lifecycle owns cleanup.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createFileMeterAdapter,
  readExecutionState,
  writePendingSignal,
  type FileMeterAdapter,
} from '@swt-labs/methodology';
import { createBudgetGate, type BudgetEvent, type BudgetGate } from '@swt-labs/runtime';
import { BudgetConfigSchema, type BudgetConfigSchemaT } from '@swt-labs/shared';
import type { Hono } from 'hono';

import { registerBudgetRoute } from './routes/budget.js';

/**
 * Default budget config when `.swt-planning/config.json` lacks a `budget`
 * section. Conservative for an alpha — research §4.3.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfigSchemaT = {
  schema_version: 1,
  milestone_usd: 10,
  tier_downgrade_threshold: 0.7,
  pause_threshold: 0.95,
  // Plan 03-03 made `projection_enabled` a required schema field
  // (default true / G-R4). Mirror cook.ts's backfilled DEFAULT_BUDGET_CONFIG
  // so the dashboard's safe-fallback keeps pre-spawn projection on.
  projection_enabled: true,
};

export interface BudgetWiringOptions {
  /**
   * Project root. The metrics dir is resolved as
   * `<projectRoot>/.swt-planning/.metrics/`. When the dir doesn't exist
   * the adapter creates it (the cook process is the writer).
   */
  readonly projectRoot: string;
  /** Override config — primarily for tests. */
  readonly configOverride?: BudgetConfigSchemaT;
  /**
   * Resolve the in-flight cook session id for signal-file writes. Default
   * reads `.execution-state.json` via `readExecutionState`. Tests inject
   * a fixed sid to avoid disk coupling.
   */
  readonly sessionIdResolver?: () => string | undefined;
  /**
   * Optional warning sink — chokidar adapter parse errors land here.
   * Default `console.warn`.
   */
  readonly onWarn?: (message: string) => void;
}

export interface BudgetWiring {
  /** Live gate (or null if construction failed). */
  readonly getGate: () => BudgetGate | null;
  /** Cleanup: close the chokidar watcher + dispose the gate. */
  dispose(): Promise<void>;
}

function findConfigFile(projectRoot: string): string | undefined {
  const vbw = path.join(projectRoot, '.vbw-planning', 'config.json');
  if (fs.existsSync(vbw)) return vbw;
  const swt = path.join(projectRoot, '.swt-planning', 'config.json');
  if (fs.existsSync(swt)) return swt;
  return undefined;
}

/**
 * Load + zod-validate the budget section of `.swt-planning/config.json`.
 * Returns `DEFAULT_BUDGET_CONFIG` when:
 *   - no config file exists
 *   - the file is malformed JSON
 *   - the `budget` block is missing or fails schema validation
 *
 * The fallback is deliberately permissive — a malformed config should not
 * crash the dashboard server.
 */
export function loadBudgetConfig(
  projectRoot: string,
  warn: (m: string) => void = (m): void => {
    console.warn(m);
  },
): BudgetConfigSchemaT {
  const file = findConfigFile(projectRoot);
  if (file === undefined) return DEFAULT_BUDGET_CONFIG;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    warn(`[budget-routes] read ${file}: ${(err as Error).message}`);
    return DEFAULT_BUDGET_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn(`[budget-routes] parse ${file}: ${(err as Error).message}`);
    return DEFAULT_BUDGET_CONFIG;
  }
  const block =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['budget']
      : undefined;
  if (block === undefined) return DEFAULT_BUDGET_CONFIG;
  // Auto-fill schema_version if absent so users don't need to know about it.
  const withVersion =
    typeof block === 'object' && block !== null && !('schema_version' in block)
      ? { schema_version: 1, ...(block as Record<string, unknown>) }
      : block;
  const result = BudgetConfigSchema.safeParse(withVersion);
  if (!result.success) {
    warn(`[budget-routes] config.json#budget invalid: ${result.error.message}`);
    return DEFAULT_BUDGET_CONFIG;
  }
  return result.data;
}

function defaultSessionIdResolver(projectRoot: string): () => string | undefined {
  return () => {
    try {
      const state = readExecutionState(projectRoot);
      return state?.session_id ?? state?.correlation_id;
    } catch {
      return undefined;
    }
  };
}

/**
 * Construct the live BudgetGate + signal-file wiring. Returns a getter the
 * route layer consumes, plus a dispose() for the server lifecycle.
 *
 * The chokidar adapter is created eagerly. If the metrics dir is missing,
 * the adapter creates it (the dashboard server boots before the first
 * `cook` invocation, so an empty dir is the common case).
 */
export function createLiveBudgetWiring(opts: BudgetWiringOptions): BudgetWiring {
  const warn =
    opts.onWarn ??
    ((m: string): void => {
      console.warn(m);
    });
  const config = opts.configOverride ?? loadBudgetConfig(opts.projectRoot, warn);
  const metricsDir = path.join(opts.projectRoot, '.swt-planning', '.metrics');

  let adapter: FileMeterAdapter | null = null;
  let gate: BudgetGate | null = null;

  try {
    adapter = createFileMeterAdapter({ metricsDir, onWarn: warn });
    gate = createBudgetGate({ config, meter: adapter });
  } catch (err) {
    warn(`[budget-routes] live wiring failed: ${(err as Error).message}`);
    return {
      getGate: () => null,
      async dispose(): Promise<void> {
        if (adapter !== null) await adapter.close();
      },
    };
  }

  const sessionIdResolver = opts.sessionIdResolver ?? defaultSessionIdResolver(opts.projectRoot);

  // Pause/resume → cook-controls signal file. Bridges the gate's
  // in-process event stream onto the existing signal-file protocol that
  // cook.ts:checkBoundarySignal consumes at the next inter-agent
  // boundary (research §4.4).
  const unsubscribeSignal = gate.subscribe((event: BudgetEvent) => {
    const sid = sessionIdResolver();
    if (sid === undefined || sid.length === 0) {
      warn(
        `[budget-routes] ${event.type} fired but no in-flight cook session id; skipping signal-file write.`,
      );
      return;
    }
    try {
      if (event.type === 'budget.pause') {
        writePendingSignal(sid, 'pause', opts.projectRoot);
      } else if (event.type === 'budget.resume') {
        writePendingSignal(sid, 'resume', opts.projectRoot);
      }
      // budget.warning is observed by the SSE stream but does NOT halt
      // the orchestrator — only 95% pause triggers the signal-file write.
    } catch (err) {
      warn(`[budget-routes] writePendingSignal failed: ${(err as Error).message}`);
    }
  });

  return {
    getGate: () => gate,
    async dispose(): Promise<void> {
      unsubscribeSignal();
      gate?.dispose();
      gate = null;
      if (adapter !== null) {
        await adapter.close();
        adapter = null;
      }
    },
  };
}

/**
 * Convenience: register `/api/budget/sse` + `/api/budget/bump` against a
 * Hono app with the live wiring composed in. The dashboard server's
 * top-level `createApp` calls this instead of the `() => null` placeholder.
 */
export function registerBudgetRoutesWithLiveWiring(
  app: Hono,
  opts: BudgetWiringOptions,
): BudgetWiring {
  const wiring = createLiveBudgetWiring(opts);
  registerBudgetRoute(app, wiring.getGate);
  return wiring;
}
