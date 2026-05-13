/**
 * Plan 04-02 T5 — file-backed TokenMeter adapter for the cache-hits SSE route.
 *
 * `registerCacheHitsRoute` expects a `TokenMeter | null` getter so its panel
 * can compute cache-hit ratio via `computeCacheHitRatio(meter.snapshot())`.
 * The methodology layer's plan 04-01 token-meter writes its aggregates to
 * `.swt-planning/.metrics/session-*.json` instead of holding them in
 * memory (research §3.4 chose file aggregator over in-memory cache so the
 * dashboard can survive a cook crash). This adapter bridges the gap:
 * pick the most-recently-updated session-*.json, synthesize a single
 * `MeterRecord` from its folded counts, and expose it through the
 * `TokenMeter` contract.
 *
 * `subscribe()` is a no-op — live updates already flow via the
 * snapshotter's chokidar watch on `.metrics/` (T2), which re-emits the
 * snapshot with the new cost numbers. The SSE route's initial-frame
 * emission + the snapshot-driven re-render covers the same ground without
 * a second subscription layer.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { MeterRecord, MeterSnapshot, MeterUpdate, TokenMeter } from '@swt-labs/shared';

const METRICS_DIR_REL = path.join('.swt-planning', '.metrics');

interface SessionMetricsFile {
  session_id?: string;
  phase_slug?: string;
  tokens?: {
    in?: number;
    out?: number;
    cache_creation?: number;
    cache_read?: number;
  };
  cost_usd?: number;
  last_updated?: string;
}

function latestSessionFile(metricsDir: string): string | null {
  if (!existsSync(metricsDir)) return null;
  let files: string[] = [];
  try {
    files = readdirSync(metricsDir).filter((n) => n.startsWith('session-') && n.endsWith('.json'));
  } catch {
    return null;
  }
  let best: { abs: string; mtime: number } | null = null;
  for (const name of files) {
    const abs = path.join(metricsDir, name);
    try {
      const st = statSync(abs);
      if (best === null || st.mtimeMs > best.mtime) best = { abs, mtime: st.mtimeMs };
    } catch {
      continue;
    }
  }
  return best?.abs ?? null;
}

function readMetrics(absPath: string): SessionMetricsFile | null {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as SessionMetricsFile;
  } catch {
    return null;
  }
}

function makeRecord(file: SessionMetricsFile): MeterRecord {
  return {
    timestamp: file.last_updated ?? new Date().toISOString(),
    milestone: '',
    phase: file.phase_slug ?? '',
    task_id: file.session_id ?? '',
    role: 'orchestrator',
    tier: 'aggregate',
    provider: 'pi',
    model: '',
    turn: 0,
    input: file.tokens?.in ?? 0,
    output: file.tokens?.out ?? 0,
    cacheRead: file.tokens?.cache_read ?? 0,
    cacheWrite: file.tokens?.cache_creation ?? 0,
    cost_usd: file.cost_usd ?? 0,
  };
}

function snapshotFor(file: SessionMetricsFile): MeterSnapshot {
  const r = makeRecord(file);
  return {
    totals: {
      input: r.input,
      output: r.output,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
      cost_usd: r.cost_usd,
    },
    records: [r],
  };
}

const EMPTY_SNAPSHOT: MeterSnapshot = {
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost_usd: 0 },
  records: [],
};

/**
 * Build a `() => TokenMeter | null` for routes that expect the
 * `TokenMeter` shape but should source their data from
 * `.swt-planning/.metrics/`. Returns `null` only when the metrics dir
 * doesn't exist (greenfield daemon); once the dir exists we always
 * return a meter so the panel can render an empty-state snapshot.
 */
export function createFileBackedMeterGetter(
  getProjectRoot: () => string | null,
): () => TokenMeter | null {
  return () => {
    const projectRoot = getProjectRoot();
    if (projectRoot === null) return null;
    const metricsDir = path.join(projectRoot, METRICS_DIR_REL);
    if (!existsSync(metricsDir)) return null;

    const meter: TokenMeter = {
      record(): void {
        // Read-only adapter — token-meter.ts in methodology writes the
        // canonical file; nothing else should mutate this snapshot.
      },
      snapshot(): MeterSnapshot {
        const latest = latestSessionFile(metricsDir);
        if (latest === null) return EMPTY_SNAPSHOT;
        const file = readMetrics(latest);
        if (file === null) return EMPTY_SNAPSHOT;
        return snapshotFor(file);
      },
      subscribe(_listener: (event: MeterUpdate) => void): () => void {
        // No-op. The snapshotter's chokidar watch on .metrics/ already
        // emits state.changed when the file moves; the SPA re-renders the
        // cache-hits panel off that signal.
        return () => undefined;
      },
    };
    return meter;
  };
}
