import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFileBackedMeterGetter } from '../src/server/lib/file-backed-meter.js';

/**
 * Plan 04-02 T5 — the cache-hits / budget SSE routes call into a
 * `TokenMeter` getter rather than reading the metrics files directly.
 * The file-backed adapter reads the latest `.swt-planning/.metrics/
 * session-*.json` and synthesizes a one-record MeterSnapshot so the
 * route's `computeCacheHitRatio(meter.snapshot())` call still works
 * without porting the routes to a file-aware shape.
 */

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-fbm-'));
  mkdirSync(path.join(root, '.swt-planning', '.metrics'), { recursive: true });
  return root;
}

describe('createFileBackedMeterGetter', () => {
  it('returns null when projectRoot is null', () => {
    const getter = createFileBackedMeterGetter(() => null);
    expect(getter()).toBeNull();
  });

  it('returns null when the .metrics/ dir is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'swt-fbm-'));
    const getter = createFileBackedMeterGetter(() => root);
    expect(getter()).toBeNull();
  });

  it('returns an empty snapshot when .metrics/ has no session files', () => {
    const root = fixtureRoot();
    const getter = createFileBackedMeterGetter(() => root);
    const meter = getter();
    expect(meter).not.toBeNull();
    expect(meter?.snapshot().records).toEqual([]);
    expect(meter?.snapshot().totals.cost_usd).toBe(0);
  });

  it('synthesizes a record from the latest session-*.json', () => {
    const root = fixtureRoot();
    writeFileSync(
      path.join(root, '.swt-planning', '.metrics', 'session-aaa.json'),
      JSON.stringify({
        session_id: 'aaa',
        phase_slug: '04-dashboard',
        tokens: { in: 100, out: 50, cache_creation: 10, cache_read: 200 },
        cost_usd: 0.42,
        last_updated: new Date().toISOString(),
      }),
    );
    const getter = createFileBackedMeterGetter(() => root);
    const meter = getter();
    const snap = meter?.snapshot();
    expect(snap?.totals.cacheRead).toBe(200);
    expect(snap?.totals.cacheWrite).toBe(10); // cache_creation maps to cacheWrite
    expect(snap?.totals.input).toBe(100);
    expect(snap?.totals.cost_usd).toBeCloseTo(0.42, 5);
    expect(snap?.records).toHaveLength(1);
    expect(snap?.records[0]?.provider).toBe('pi');
    expect(snap?.records[0]?.phase).toBe('04-dashboard');
    expect(snap?.records[0]?.task_id).toBe('aaa');
  });

  it('subscribe() is a no-op (file changes flow via the snapshotter watch)', () => {
    const root = fixtureRoot();
    const getter = createFileBackedMeterGetter(() => root);
    const meter = getter();
    const fired: number[] = [];
    const unsubscribe = meter?.subscribe(() => fired.push(1));
    expect(typeof unsubscribe).toBe('function');
    unsubscribe?.();
    expect(fired).toEqual([]);
  });
});
