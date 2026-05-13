/**
 * Plan 06-02 T1 — File-meter → TokenMeter adapter (REQ-16, R5).
 *
 * Bridges the file-aggregator pattern that `token-meter.ts:recordUsage` uses
 * (writing `.swt-planning/.metrics/session-*.json` after each cook.agent_result)
 * to the in-memory `TokenMeter` interface that `BudgetGate` consumes
 * (`packages/runtime/src/budget/gate.ts:34`).
 *
 * The adapter:
 *   1. chokidar-watches `<metricsDir>/session-*.json`.
 *   2. On each `add` event, captures the current cumulative state as a
 *      baseline so the FIRST observed write doesn't emit a giant delta.
 *   3. On each `change` event, parses the file, computes the delta vs the
 *      prior snapshot per file, and emits a `MeterUpdate` to subscribers.
 *   4. Tolerates JSON parse errors (partially-written files are transient;
 *      the next chokidar event resolves them).
 *   5. Guards against negative deltas (file recreated / clock skew) by
 *      gating emission on `delta.cost_usd > 0 || delta tokens > 0`.
 *
 * The adapter exposes the full `TokenMeter` interface for type compatibility
 * with `createBudgetGate({meter, config})`; only `subscribe` is meaningful
 * for the gate. `record` is accepted (no-op write-through to the file would
 * race the canonical writer in `token-meter.ts`) and `snapshot` returns the
 * accumulated totals across all watched session files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import chokidar from 'chokidar';

import type {
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
  TokenMeter,
} from '@swt-labs/shared';

import type { SessionMetrics } from './token-meter.js';

export interface CreateFileMeterAdapterOptions {
  /** Directory containing `session-*.json` aggregates. */
  readonly metricsDir: string;
  /**
   * Optional clock for deterministic test assertions. Returns ISO string.
   * Default: `() => new Date().toISOString()`.
   */
  readonly clock?: () => string;
  /**
   * Optional sink for non-fatal warnings (e.g., JSON parse errors). Default
   * logs via `console.warn`. Tests inject a capture sink to assert the
   * tolerance contract.
   */
  readonly onWarn?: (message: string) => void;
}

export interface FileMeterAdapter extends TokenMeter {
  /** Close the underlying chokidar watcher. */
  close(): Promise<void>;
}

interface PerFileSnapshot {
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_creation: number;
  agent_results: number;
}

const ZERO_SNAPSHOT: PerFileSnapshot = {
  cost_usd: 0,
  tokens_in: 0,
  tokens_out: 0,
  cache_read: 0,
  cache_creation: 0,
  agent_results: 0,
};

function readSnapshot(filePath: string): PerFileSnapshot {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<SessionMetrics>;
  const tokens = parsed.tokens ?? { in: 0, out: 0, cache_creation: 0, cache_read: 0 };
  return {
    cost_usd: typeof parsed.cost_usd === 'number' ? parsed.cost_usd : 0,
    tokens_in: typeof tokens.in === 'number' ? tokens.in : 0,
    tokens_out: typeof tokens.out === 'number' ? tokens.out : 0,
    cache_read: typeof tokens.cache_read === 'number' ? tokens.cache_read : 0,
    cache_creation: typeof tokens.cache_creation === 'number' ? tokens.cache_creation : 0,
    agent_results: typeof parsed.agent_results === 'number' ? parsed.agent_results : 0,
  };
}

function deriveSessionIdFromPath(filePath: string): string {
  const base = path.basename(filePath, '.json');
  // strip leading "session-" if present
  return base.startsWith('session-') ? base.slice('session-'.length) : base;
}

/**
 * Build a TokenMeter that surfaces deltas in `.swt-planning/.metrics/` files
 * to subscribers. Pure file watcher; no per-call IO from subscribers' POV.
 */
export function createFileMeterAdapter(
  opts: CreateFileMeterAdapterOptions,
): FileMeterAdapter {
  const clock = opts.clock ?? ((): string => new Date().toISOString());
  const warn =
    opts.onWarn ??
    ((message: string): void => {
      // eslint-disable-next-line no-console
      console.warn(message);
    });
  const listeners: Array<(event: MeterUpdate) => void> = [];
  const lastSeen = new Map<string, PerFileSnapshot>();

  // Aggregate totals across all watched files (for snapshot()).
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd: 0,
  };

  // Ensure the metrics dir exists so chokidar doesn't ENOENT.
  fs.mkdirSync(opts.metricsDir, { recursive: true });

  // chokidar 4 supports glob patterns via the `chokidar` constructor's array
  // form; we watch the dir + filter by filename to keep behavior consistent
  // across glob implementations.
  const watcher = chokidar.watch(opts.metricsDir, {
    persistent: true,
    ignoreInitial: false,
    depth: 0,
  });

  const isSessionFile = (p: string): boolean => {
    const base = path.basename(p);
    return base.startsWith('session-') && base.endsWith('.json');
  };

  const emit = (filePath: string, current: PerFileSnapshot): void => {
    const prev = lastSeen.get(filePath) ?? ZERO_SNAPSHOT;
    const delta: PerFileSnapshot = {
      cost_usd: current.cost_usd - prev.cost_usd,
      tokens_in: current.tokens_in - prev.tokens_in,
      tokens_out: current.tokens_out - prev.tokens_out,
      cache_read: current.cache_read - prev.cache_read,
      cache_creation: current.cache_creation - prev.cache_creation,
      agent_results: current.agent_results - prev.agent_results,
    };
    lastSeen.set(filePath, current);

    // Negative-delta guard — recreated files or clock skew shouldn't fire.
    const positive =
      delta.cost_usd > 0 ||
      delta.tokens_in > 0 ||
      delta.tokens_out > 0 ||
      delta.cache_read > 0 ||
      delta.cache_creation > 0;
    if (!positive) return;

    totals.input += Math.max(0, delta.tokens_in);
    totals.output += Math.max(0, delta.tokens_out);
    totals.cacheRead += Math.max(0, delta.cache_read);
    totals.cacheWrite += Math.max(0, delta.cache_creation);
    totals.cost_usd += Math.max(0, delta.cost_usd);

    const sessionId = deriveSessionIdFromPath(filePath);
    const record: MeterRecord = {
      timestamp: clock(),
      milestone: '',
      phase: '',
      task_id: sessionId,
      role: '',
      tier: '',
      provider: '',
      model: '',
      turn: 0,
      input: Math.max(0, delta.tokens_in),
      output: Math.max(0, delta.tokens_out),
      cacheRead: Math.max(0, delta.cache_read),
      cacheWrite: Math.max(0, delta.cache_creation),
      cost_usd: Math.max(0, delta.cost_usd),
    };
    const update: MeterUpdate = { type: 'METER_UPDATED', record };
    for (const l of [...listeners]) l(update);
  };

  watcher.on('add', (filePath) => {
    if (!isSessionFile(filePath)) return;
    try {
      const snap = readSnapshot(filePath);
      // Initial-snapshot resolution: treat the pre-existing file as the
      // baseline; subscribers only see DELTAS going forward.
      lastSeen.set(filePath, snap);
    } catch (err) {
      warn(
        `[file-meter-adapter] add: parse error for ${filePath}: ${(err as Error).message}`,
      );
    }
  });

  watcher.on('change', (filePath) => {
    if (!isSessionFile(filePath)) return;
    try {
      const snap = readSnapshot(filePath);
      emit(filePath, snap);
    } catch (err) {
      warn(
        `[file-meter-adapter] change: parse error for ${filePath}: ${(err as Error).message}`,
      );
    }
  });

  return {
    record(_record, _costUsd): void {
      // No-op: the canonical writer is `token-meter.ts:recordUsage`. This
      // adapter is read-side only; if a caller writes through the adapter,
      // it would race the file aggregator. Future enhancement could fold
      // the call through `recordUsage` directly, but per Plan 06-02 the
      // adapter is one-way (file → meter event).
    },
    snapshot(): MeterSnapshot {
      return {
        totals: {
          input: totals.input,
          output: totals.output,
          cacheRead: totals.cacheRead,
          cacheWrite: totals.cacheWrite,
          cost_usd: totals.cost_usd,
        },
        records: [],
      };
    },
    subscribe(listener): () => void {
      listeners.push(listener);
      return (): void => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    async close(): Promise<void> {
      await watcher.close();
      listeners.length = 0;
    },
  };
}
