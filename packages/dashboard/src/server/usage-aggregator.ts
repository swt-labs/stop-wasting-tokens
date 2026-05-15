/**
 * Plan 01-01 T2 (milestone 08, Phase 01) — local rolling-usage aggregator.
 *
 * Subscribes to the existing dashboard `EventBus` (no new chokidar / fs.watch
 * / createFileTailer instance — Scout Q3: the events-tailer already parses
 * JSONL via `tail-file.ts` with byte-offset incremental reads + partial-line
 * handling + schema validation, and re-publishes typed SnapshotEvent objects
 * onto the bus. A second watcher would double-watch the directory).
 *
 * Sole cost-bearing input is `cook.agent_result` (Scout Q1): the only event
 * variant carrying `session_id` + per-call `usage.cost_usd` + per-call
 * `usage.input_tokens` + `usage.output_tokens` in one row. The aggregator
 * deliberately ignores:
 *   - `agent.complete` — pre-cook-IPC shape, no `session_id`
 *   - `cook.completion`  — single-per-session, `total_cost_usd` optional
 *   - `cook.budget_exceeded` — cumulative gate state, not incremental
 *
 * Behaviour per Scout Q4 option A + Q5 + Q6 Option X + Q10:
 *   - Maintain a flat in-memory record array.
 *   - On every `cook.agent_result`: append, prune older-than-31d entries,
 *     synchronously recompute, then publish a `state.changed` partial
 *     snapshot onto the bus with `{ snapshot: { usage_rollup: ... } }`.
 *   - Windows are rolling N×24h UTC epoch-ms math evaluated against each
 *     event's own `ts`, NOT calendar days. Inclusive at the boundary
 *     (`<= N*24h` ⇒ a record at exactly 7d ago is IN window_7d). The 31d
 *     prune uses strict `>` so a record at exactly 30d is retained.
 *   - Empty-state (no records seen) → `{ window_7d: null, window_30d: null,
 *     generated_at }`; a window with zero matching records when the array
 *     is non-empty returns `{ cost_usd: 0, tokens_in: 0, tokens_out: 0 }`
 *     (null is reserved for "no records seen at all").
 *
 * Sub-session-id deduplication is intentionally NOT done in this phase
 * (Decision 10 in 01-01-PLAN.md). Scout Q2 warns about potential
 * daemon-vs-cook-subprocess duplicate file emissions, but the events-tailer
 * has not been empirically observed double-emitting the same row at this
 * point. Speculative dedup risks UNDER-counting if Pi only emits each row
 * once. Deferred pending Phase 02 UAT observation.
 *
 * Forbidden imports (Scout Q9): no `chokidar`, no `fs.watch`, no
 * `createFileTailer`, no `@swt-labs/telemetry` (strictly outbound pipeline,
 * doesn't fit local-aggregation semantics).
 */

import type { SnapshotEvent, UsageRollup, UsageWindow } from '@swt-labs/shared';

import type { EventBus, Unsubscribe } from './event-bus.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_7D_MS = 7 * DAY_MS;
const WINDOW_30D_MS = 30 * DAY_MS;
const PRUNE_MS = 31 * DAY_MS;

export interface UsageAggregatorOptions {
  /** The existing dashboard EventBus the events-tailer publishes onto. */
  bus: EventBus;
  /** Test seam; defaults to `() => Date.now()`. */
  now?: () => number;
}

export interface UsageAggregator {
  /**
   * Synchronously compute the current rollup. Pure function over the
   * in-memory record array — never throws.
   */
  compute(): UsageRollup;
  /** Unsubscribe from the bus. Records remain (the next caller can re-subscribe). */
  close(): void;
}

interface UsageRecord {
  readonly ts_ms: number;
  readonly cost_usd: number;
  readonly tokens_in: number;
  readonly tokens_out: number;
}

export function createUsageAggregator(options: UsageAggregatorOptions): UsageAggregator {
  const { bus } = options;
  const now = options.now ?? ((): number => Date.now());
  const records: UsageRecord[] = [];

  const compute = (): UsageRollup => {
    const nowMs = now();
    const generated_at = new Date(nowMs).toISOString();

    if (records.length === 0) {
      return { window_7d: null, window_30d: null, generated_at };
    }

    let cost7 = 0;
    let in7 = 0;
    let out7 = 0;
    let cost30 = 0;
    let in30 = 0;
    let out30 = 0;

    for (const r of records) {
      const age = nowMs - r.ts_ms;
      if (age <= WINDOW_7D_MS) {
        cost7 += r.cost_usd;
        in7 += r.tokens_in;
        out7 += r.tokens_out;
      }
      if (age <= WINDOW_30D_MS) {
        cost30 += r.cost_usd;
        in30 += r.tokens_in;
        out30 += r.tokens_out;
      }
    }

    const window_7d: UsageWindow = { cost_usd: cost7, tokens_in: in7, tokens_out: out7 };
    const window_30d: UsageWindow = { cost_usd: cost30, tokens_in: in30, tokens_out: out30 };
    return { window_7d, window_30d, generated_at };
  };

  const onEvent = (event: SnapshotEvent): void => {
    // Single-event subscription per Scout Q1: cook.agent_result is the
    // canonical per-row cost source. All other event types — including
    // agent.complete (no session_id), cook.completion (cumulative,
    // optional cost), cook.budget_exceeded (gate-state snapshot), and
    // the partial state.changed feedback events the aggregator itself
    // publishes — are ignored here.
    if (event.type !== 'cook.agent_result') return;

    const ts_ms = Date.parse(event.ts);
    if (!Number.isFinite(ts_ms)) return; // unparseable timestamp; skip rather than crash.

    const cost_usd = event.usage.cost_usd ?? 0;
    const tokens_in = event.usage.input_tokens;
    const tokens_out = event.usage.output_tokens;

    // Append unconditionally — even zero-contribution rows. Window math
    // handles them correctly, and dropping them would mask events the
    // bus delivered (visibility > frugality).
    records.push({ ts_ms, cost_usd, tokens_in, tokens_out });

    // Scout Q10: prune to a 31-day sliding window. Strict `>` keeps a
    // record at exactly 30d (the inclusive 30d window boundary). Bounds
    // memory regardless of total session history.
    const nowMs = now();
    let writeIdx = 0;
    for (const r of records) {
      if (nowMs - r.ts_ms <= PRUNE_MS) {
        records[writeIdx++] = r;
      }
    }
    records.length = writeIdx;

    const result = compute();

    // Scout Q6 Option X: publish a `state.changed` partial directly onto
    // the bus instead of mutating buildSnapshot. The SPA's SSE handler
    // already merges partial snapshots; this avoids coupling the
    // runtime-layer aggregator to the file-walking reducer.
    bus.publish({
      type: 'state.changed',
      ts: new Date(nowMs).toISOString(),
      // `changed` enum lacks a dedicated 'usage' tag; 'cost' is the
      // closest semantic match (usage_rollup is a cost-bearing summary).
      changed: ['cost'],
      snapshot: { usage_rollup: result },
    });
  };

  const unsubscribe: Unsubscribe = bus.subscribe(onEvent);

  return {
    compute,
    close: (): void => {
      unsubscribe();
    },
  };
}
