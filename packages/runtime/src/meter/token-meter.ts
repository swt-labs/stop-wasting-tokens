/**
 * In-memory token meter — per TDD2 §8.1.
 *
 * Aggregates per-turn `MeterRecord` rows into a snapshot grouped by
 * `task_id`, `phase`, `milestone`, and `provider`. Subscribers receive a
 * `METER_UPDATED` event on every `record()` call.
 *
 * The meter is constructor-injected into `SwtSession` via
 * `SwtSessionOptions.meter` (locked in at Plan 01-01 PR-04 review). It
 * never reaches into Pi — `runtime/src/session.ts` is responsible for
 * mapping Pi `turn_end` events into `record()` calls.
 *
 * Optional JSONL persistence is wired here but defaulted off. PR-07
 * ships the in-memory path only; persistence is a thin wrapper.
 * Persisted files are deterministic per cassette replay, which the
 * cassette-replay integration test relies on for byte-identical
 * assertions (delta = 0).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
  TokenMeter,
} from '@swt-labs/shared';

export interface CreateTokenMeterOptions {
  /** When true, every record() also appends a JSONL row to persistPath. */
  readonly persist?: boolean;
  /** Required when persist=true; path is created on first append. */
  readonly persistPath?: string;
}

export function createTokenMeter(opts: CreateTokenMeterOptions = {}): TokenMeter {
  const records: MeterRecord[] = [];
  const listeners: Array<(event: MeterUpdate) => void> = [];
  let persistInitialized = false;

  function appendJsonl(record: MeterRecord): void {
    if (!opts.persist) return;
    if (!opts.persistPath) {
      throw new Error('createTokenMeter: persist=true requires persistPath.');
    }
    if (!persistInitialized) {
      mkdirSync(dirname(opts.persistPath), { recursive: true });
      persistInitialized = true;
    }
    appendFileSync(opts.persistPath, JSON.stringify(record) + '\n', 'utf8');
  }

  return {
    record(partial, costUsd): void {
      const full: MeterRecord = { ...partial, cost_usd: costUsd };
      records.push(full);
      const event: MeterUpdate = { type: 'METER_UPDATED', record: full };
      // Snapshot listener list to avoid mutation-during-iteration if a
      // listener unsubscribes itself during dispatch.
      for (const listener of listeners.slice()) {
        listener(event);
      }
      appendJsonl(full);
    },

    snapshot(): MeterSnapshot {
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheRead = 0;
      let totalCacheWrite = 0;
      let totalCost = 0;
      for (const r of records) {
        totalInput += r.input;
        totalOutput += r.output;
        totalCacheRead += r.cacheRead;
        totalCacheWrite += r.cacheWrite;
        totalCost += r.cost_usd;
      }
      return {
        totals: {
          input: totalInput,
          output: totalOutput,
          cacheRead: totalCacheRead,
          cacheWrite: totalCacheWrite,
          cost_usd: totalCost,
        },
        records: records.slice(),
      };
    },

    subscribe(listener): () => void {
      listeners.push(listener);
      return (): void => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

/**
 * Helper: group a snapshot's records by an arbitrary dimension. Used by
 * dashboard panels that want "tokens by phase" or "tokens by provider"
 * views without re-aggregating from scratch.
 */
export function groupRecordsByDimension(
  snapshot: MeterSnapshot,
  dimension: keyof Pick<MeterRecord, 'task_id' | 'phase' | 'milestone' | 'provider' | 'role'>,
): Map<string, MeterRecord[]> {
  const out = new Map<string, MeterRecord[]>();
  for (const r of snapshot.records) {
    const key = r[dimension];
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    bucket.push(r);
  }
  return out;
}
