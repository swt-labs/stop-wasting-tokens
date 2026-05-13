/**
 * Plan 03-03 (Phase 3) Task T4 — swt map handler coverage.
 *
 * Coverage:
 *   - Registered in buildRegistry()
 *   - spawnAgent called EXACTLY 4 times with role: 'scout' (REQ-04)
 *   - All 4 spawns happen CONCURRENTLY (not sequentially) — verified via
 *     a deferred mock that records the in-flight count when each starts
 *   - If any one spawn rejects, handler returns EXIT.RUNTIME_ERROR but the
 *     other 3 still complete (no short-circuit)
 *   - Each spawn gets a distinct per-slice session id
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TaskResult } from '@swt-labs/shared';

import { buildSlicePrompt, MAP_SLICES, makeMapHandler } from '../../src/commands/map.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-map-test-repo';
const TEST_SESSION_ID = 'map-test-session-id';

const STUB_MAP_MD = `---
name: swt:map
---

# SWT Map

Working directory: \${SWT_INSTALL_ROOT}

Map the codebase.
`;

interface HarnessOpts {
  /** When provided, each successive scout returns the corresponding result/throw. */
  readonly perScout?: ReadonlyArray<TaskResult | Error>;
}

function defaultResult(): TaskResult {
  return {
    schema_version: 1,
    task_id: 'map-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
  };
}

function buildMapHarness(opts: HarnessOpts = {}) {
  const perScout = opts.perScout ?? [defaultResult(), defaultResult(), defaultResult(), defaultResult()];

  let callIdx = 0;
  // Concurrency-tracking deferred mock: increments `inFlight` on start,
  // records the maximum, then resolves after a microtask so all 4 must be
  // started before any resolves.
  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt: number[] = [];
  const resolvedAt: number[] = [];
  let counter = 0;

  const spawnAgentImpl = vi.fn(async () => {
    const idx = callIdx++;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    startedAt.push(counter++);
    // Yield to the event loop so the OTHER 3 calls also get to enter
    // this function before any returns.
    await new Promise((res) => setImmediate(res));
    inFlight -= 1;
    resolvedAt.push(counter++);
    const outcome = perScout[idx];
    if (outcome instanceof Error) throw outcome;
    return outcome ?? defaultResult();
  });

  const readFileSyncImpl = vi.fn((_p: unknown, _enc?: unknown) => STUB_MAP_MD);

  const handler = makeMapHandler({
    spawnAgentImpl: spawnAgentImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
  });

  const stderr: string[] = [];
  const stdout: string[] = [];
  const io: CommandIO = {
    cwd: REPO_ROOT,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
  };

  async function run() {
    return handler({ verb: 'map', positionals: [], flags: {} }, io);
  }

  return {
    run,
    spawnAgentImpl,
    readFileSyncImpl,
    maxInFlight: () => maxInFlight,
    startedAt: () => startedAt.slice(),
    resolvedAt: () => resolvedAt.slice(),
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — mapHandler (Plan 03-03 T4 / REQ-04)', () => {
  it('is registered in buildRegistry() as a real verb (not a stub)', () => {
    const reg = buildRegistry();
    const spec = reg.get('map');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('parallel');
  });

  it('MAP_SLICES has exactly 4 slices with distinct output paths', () => {
    expect(MAP_SLICES).toHaveLength(4);
    const allPaths = MAP_SLICES.flatMap((s) => s.outputPaths);
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });

  it('buildSlicePrompt appends a Map Slice trailer naming the slice id + output paths', () => {
    const slice = MAP_SLICES[0]!;
    const out = buildSlicePrompt('BODY', slice);
    expect(out).toContain('BODY');
    expect(out).toContain(`## Map Slice ${slice.id}: ${slice.title}`);
    for (const p of slice.outputPaths) {
      expect(out).toContain(p);
    }
  });

  it('spawnAgent is called EXACTLY 4 times with role="scout"', async () => {
    const h = buildMapHarness();
    const exit = await h.run();
    expect(exit).toBe(0);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i += 1) {
      const args = h.spawnAgentImpl.mock.calls[i]?.[0];
      expect(args?.role).toBe('scout');
    }
  });

  it('all 4 spawns happen CONCURRENTLY (Promise.all fan-out, REQ-04)', async () => {
    const h = buildMapHarness();
    await h.run();
    // All 4 scouts must be in-flight before any resolve. The deferred mock
    // yields via setImmediate after recording start; if the handler were
    // sequential, maxInFlight would be 1, not 4.
    expect(h.maxInFlight()).toBe(4);
    // Counter-based proof: the first 4 events are STARTs (idx 0..3) and
    // the next 4 are RESOLVEs (idx 4..7). If sequential we'd see
    // start, resolve, start, resolve, ... interleaved.
    const started = h.startedAt();
    const resolved = h.resolvedAt();
    expect(Math.max(...started)).toBeLessThan(Math.min(...resolved));
  });

  it('each spawn gets a distinct per-slice session id', async () => {
    const h = buildMapHarness();
    await h.run();
    const sessionIds = h.spawnAgentImpl.mock.calls.map((c) => c[0].sessionId);
    expect(new Set(sessionIds).size).toBe(4);
    for (const id of sessionIds) {
      expect(id).toContain('slice-');
    }
  });

  it('returns EXIT.RUNTIME_ERROR when one scout rejects, BUT still awaits the other 3', async () => {
    const h = buildMapHarness({
      perScout: [defaultResult(), new Error('slice 2 boom'), defaultResult(), defaultResult()],
    });
    const exit = await h.run();
    expect(exit).toBe(3);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(4);
    expect(h.stderr()).toContain('slice 2 boom');
  });

  it('returns EXIT.RUNTIME_ERROR when a scout returns status="failed"', async () => {
    const failed: TaskResult = { ...defaultResult(), status: 'failed' };
    const h = buildMapHarness({
      perScout: [defaultResult(), failed, defaultResult(), defaultResult()],
    });
    const exit = await h.run();
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('1/4');
  });
});
