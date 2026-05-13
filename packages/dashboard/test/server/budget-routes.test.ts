/**
 * Plan 06-02 T3 — integration tests for live BudgetGate wiring.
 *
 * Covers:
 *   - loadBudgetConfig defaults + override from `.swt-planning/config.json`.
 *   - createLiveBudgetWiring wires a real chokidar adapter + BudgetGate;
 *     writing a session-*.json that crosses pause_threshold fires
 *     budget.pause and writes `.cook-controls/<sid>.pending = 'pause'`.
 *   - bumpCeiling on the gate transitions back to ok + writes 'resume'.
 *   - SSE route emits the live gate snapshot once an event fires.
 */

import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLiveBudgetWiring,
  loadBudgetConfig,
  DEFAULT_BUDGET_CONFIG,
} from '../../src/server/budget-routes.js';
import { registerBudgetRoute } from '../../src/server/routes/budget.js';

let root: string;

async function waitFor<T>(
  pred: () => T | undefined | null | false,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = pred();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'swt-budget-routes-'));
  fs.mkdirSync(join(root, '.swt-planning', '.metrics'), { recursive: true });
  fs.mkdirSync(join(root, '.swt-planning', '.cook-controls'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadBudgetConfig', () => {
  it('returns DEFAULT_BUDGET_CONFIG when no config file exists', () => {
    const cfg = loadBudgetConfig(root, () => undefined);
    expect(cfg).toEqual(DEFAULT_BUDGET_CONFIG);
  });

  it('reads the budget block from .swt-planning/config.json', () => {
    fs.writeFileSync(
      join(root, '.swt-planning', 'config.json'),
      JSON.stringify({
        budget: {
          milestone_usd: 25,
          tier_downgrade_threshold: 0.5,
          pause_threshold: 0.9,
        },
      }),
    );
    const cfg = loadBudgetConfig(root, () => undefined);
    expect(cfg.milestone_usd).toBe(25);
    expect(cfg.tier_downgrade_threshold).toBe(0.5);
    expect(cfg.pause_threshold).toBe(0.9);
  });

  it('falls back to defaults when config.json is malformed JSON', () => {
    fs.writeFileSync(join(root, '.swt-planning', 'config.json'), 'not json');
    const warnings: string[] = [];
    const cfg = loadBudgetConfig(root, (m) => warnings.push(m));
    expect(cfg).toEqual(DEFAULT_BUDGET_CONFIG);
    expect(warnings.join('\n')).toMatch(/parse/);
  });
});

describe('createLiveBudgetWiring — chokidar → BudgetGate → signal file', () => {
  it('fires budget.pause + writes cook-controls signal file when spend crosses pause_threshold', async () => {
    const SID = 'test-sid-pause';
    const wiring = createLiveBudgetWiring({
      projectRoot: root,
      configOverride: {
        schema_version: 1,
        milestone_usd: 10,
        tier_downgrade_threshold: 0.7,
        pause_threshold: 0.95,
      },
      sessionIdResolver: () => SID,
    });

    try {
      // Wait for chokidar to ready.
      await new Promise((r) => setTimeout(r, 250));

      // Write a session-*.json that crosses 95% of $10 milestone.
      const metricsFile = join(root, '.swt-planning', '.metrics', 'session-test.json');
      fs.writeFileSync(
        metricsFile,
        JSON.stringify({
          session_id: 'test',
          agent_results: 1,
          tokens: { in: 1000, out: 500, cache_creation: 0, cache_read: 0 },
          cost_usd: 0, // baseline at 0
          cache_hit_ratio: 0,
          last_updated: 't0',
        }),
      );
      await new Promise((r) => setTimeout(r, 300));

      // Now overwrite with a value that crosses 95% pause threshold.
      fs.writeFileSync(
        metricsFile,
        JSON.stringify({
          session_id: 'test',
          agent_results: 2,
          tokens: { in: 2000, out: 1000, cache_creation: 0, cache_read: 0 },
          cost_usd: 9.6,
          cache_hit_ratio: 0,
          last_updated: 't1',
        }),
      );

      // Wait for the signal-file write.
      const signalPath = join(
        root,
        '.swt-planning',
        '.cook-controls',
        `${SID}.pending`,
      );
      await waitFor(() => (fs.existsSync(signalPath) ? signalPath : undefined), 5000);
      const sig = fs.readFileSync(signalPath, 'utf-8');
      expect(sig).toBe('pause');

      // Gate state reflects paused.
      const gate = wiring.getGate();
      expect(gate).not.toBeNull();
      expect(gate?.state().status).toBe('paused');
      expect(gate?.state().spent_usd).toBeCloseTo(9.6, 6);
    } finally {
      await wiring.dispose();
    }
  }, 10_000);

  it('bumpCeiling transitions to ok + writes resume signal', async () => {
    const SID = 'test-sid-resume';
    const wiring = createLiveBudgetWiring({
      projectRoot: root,
      configOverride: {
        schema_version: 1,
        milestone_usd: 10,
        tier_downgrade_threshold: 0.7,
        pause_threshold: 0.95,
      },
      sessionIdResolver: () => SID,
    });

    try {
      await new Promise((r) => setTimeout(r, 250));
      const metricsFile = join(root, '.swt-planning', '.metrics', 'session-r.json');
      fs.writeFileSync(
        metricsFile,
        JSON.stringify({
          session_id: 'r',
          agent_results: 1,
          tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
          cost_usd: 0,
          cache_hit_ratio: 0,
          last_updated: 't0',
        }),
      );
      await new Promise((r) => setTimeout(r, 250));
      fs.writeFileSync(
        metricsFile,
        JSON.stringify({
          session_id: 'r',
          agent_results: 2,
          tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
          cost_usd: 9.6,
          cache_hit_ratio: 0,
          last_updated: 't1',
        }),
      );

      const signalPath = join(
        root,
        '.swt-planning',
        '.cook-controls',
        `${SID}.pending`,
      );
      await waitFor(() => (fs.existsSync(signalPath) ? true : undefined), 5000);
      // Consume the pause signal (simulates the orchestrator reading it).
      fs.unlinkSync(signalPath);

      // Bump ceiling so spend drops below the warning threshold.
      const gate = wiring.getGate();
      gate?.bumpCeiling(10);

      // Resume signal should land.
      await waitFor(() => (fs.existsSync(signalPath) ? true : undefined), 2000);
      const sig = fs.readFileSync(signalPath, 'utf-8');
      expect(sig).toBe('resume');
      expect(gate?.state().status).toBe('ok');
    } finally {
      await wiring.dispose();
    }
  }, 10_000);

  it('SSE route emits the live gate state when wired', async () => {
    const wiring = createLiveBudgetWiring({
      projectRoot: root,
      configOverride: {
        schema_version: 1,
        milestone_usd: 100,
        tier_downgrade_threshold: 0.7,
        pause_threshold: 0.95,
      },
      sessionIdResolver: () => 'sid-sse',
    });

    try {
      const app = new Hono();
      registerBudgetRoute(app, wiring.getGate);

      const res = await app.request('/api/budget/sse');
      expect(res.status).toBe(200);
      const body = res.body;
      if (!body) throw new Error('SSE response had no body');
      const reader = body.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = '';
        const start = Date.now();
        let frame: { state?: { ceiling_usd?: number; status?: string } } | undefined;
        while (Date.now() - start < 2000) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const m = buffer.match(/event: budget\.snapshot\ndata: ({.*?})\n\n/);
          if (m && m[1]) {
            frame = JSON.parse(m[1]) as { state?: { ceiling_usd?: number; status?: string } };
            break;
          }
        }
        expect(frame?.state?.ceiling_usd).toBe(100);
        expect(frame?.state?.status).toBe('ok');
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } finally {
      await wiring.dispose();
    }
  }, 10_000);
});
