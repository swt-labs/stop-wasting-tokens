import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readPhaseMetrics,
  readSessionMetrics,
  recordUsage,
  type SessionMetrics,
} from '../../src/meters/token-meter.js';

/**
 * Plan 04-01 (Phase 4) T3 — token-meter file aggregator.
 *
 * Behaviour under test:
 *  - first recordUsage call writes a fresh session-{id}.json with the
 *    folded tokens / cost / cache_hit_ratio
 *  - subsequent calls accumulate (agent_results increments; tokens add up)
 *  - phaseSlug fans the same payload into phase-{slug}.json
 *  - missing cost_usd leaves the running total at 0 (Phase 5 spillover)
 *  - readSessionMetrics / readPhaseMetrics round-trip the on-disk shape
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-token-meter-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const planningRoot = () => dir;

describe('@swt-labs/methodology — token-meter', () => {
  it('first call writes a fresh session metrics file', async () => {
    const result = recordUsage({
      sessionId: 'sess-1',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
        cost_usd: 0.01,
      },
      planningRoot: planningRoot(),
    });
    expect(result.agent_results).toBe(1);
    expect(result.tokens).toEqual({ in: 100, out: 50, cache_creation: 10, cache_read: 5 });
    expect(result.cost_usd).toBeCloseTo(0.01);
    expect(result.cache_hit_ratio).toBeCloseTo(5 / (100 + 10 + 5));
    expect(result.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const raw = await readFile(join(dir, '.metrics', 'session-sess-1.json'), 'utf-8');
    const persisted = JSON.parse(raw) as SessionMetrics;
    expect(persisted.tokens.in).toBe(100);
  });

  it('subsequent calls accumulate across invocations (file-backed, no in-memory cache)', () => {
    recordUsage({
      sessionId: 'sess-2',
      usage: { input_tokens: 100, output_tokens: 50 },
      planningRoot: planningRoot(),
    });
    const second = recordUsage({
      sessionId: 'sess-2',
      usage: { input_tokens: 25, output_tokens: 25, cost_usd: 0.005 },
      planningRoot: planningRoot(),
    });
    expect(second.agent_results).toBe(2);
    expect(second.tokens.in).toBe(125);
    expect(second.tokens.out).toBe(75);
    expect(second.cost_usd).toBeCloseTo(0.005);
  });

  it('cost_usd stays 0 when usage payload omits it (Phase 5 spillover)', () => {
    const result = recordUsage({
      sessionId: 'sess-3',
      usage: { input_tokens: 1000, output_tokens: 200 },
      planningRoot: planningRoot(),
    });
    expect(result.cost_usd).toBe(0);
  });

  it('phaseSlug fans into a sibling phase-{slug}.json aggregator', () => {
    recordUsage({
      sessionId: 'sess-4',
      phaseSlug: '04-dashboard',
      usage: { input_tokens: 200, output_tokens: 100, cost_usd: 0.02 },
      planningRoot: planningRoot(),
    });
    recordUsage({
      sessionId: 'sess-5',
      phaseSlug: '04-dashboard',
      usage: { input_tokens: 300, output_tokens: 150, cost_usd: 0.03 },
      planningRoot: planningRoot(),
    });
    const phase = readPhaseMetrics('04-dashboard', planningRoot());
    expect(phase).not.toBeNull();
    expect(phase?.agent_results).toBe(2);
    expect(phase?.tokens.in).toBe(500);
    expect(phase?.cost_usd).toBeCloseTo(0.05);
  });

  it('readSessionMetrics returns null when the file does not exist', () => {
    expect(readSessionMetrics('nonexistent', planningRoot())).toBeNull();
  });

  it('readPhaseMetrics round-trips the on-disk shape', () => {
    recordUsage({
      sessionId: 'sess-6',
      phaseSlug: '05-bench',
      usage: { input_tokens: 11, output_tokens: 22 },
      planningRoot: planningRoot(),
    });
    const got = readPhaseMetrics('05-bench', planningRoot());
    expect(got?.tokens.in).toBe(11);
    expect(got?.tokens.out).toBe(22);
  });

  it('cache_hit_ratio is 0 when no tokens have been recorded', () => {
    const result = recordUsage({
      sessionId: 'sess-7',
      usage: { input_tokens: 0, output_tokens: 0 },
      planningRoot: planningRoot(),
    });
    expect(result.cache_hit_ratio).toBe(0);
  });
});
