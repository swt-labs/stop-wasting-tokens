/**
 * `/api/budget/sse` + `/api/budget/bump` route tests per Plan 04-01 PR-35.
 */

import type { BudgetGate, BudgetGateState } from '@swt-labs/runtime';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerBudgetRoute } from '../src/server/routes/budget.js';

interface ParsedSse {
  event?: string;
  data?: string;
}

function parseSseChunk(chunk: string): ParsedSse[] {
  const blocks = chunk.split(/\n\n/);
  const parsed: ParsedSse[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const out: ParsedSse = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) out.event = line.slice(6).trim();
      else if (line.startsWith('data:')) out.data = (out.data ?? '') + line.slice(5).trim();
    }
    if (out.event || out.data) parsed.push(out);
  }
  return parsed;
}

async function readUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matcher: (evt: ParsedSse) => boolean,
  timeoutMs: number,
): Promise<ParsedSse> {
  const decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '';
  while (Date.now() - start < timeoutMs) {
    const { value, done } = await reader.read();
    if (done) throw new Error('SSE stream closed before matching event arrived');
    buffer += decoder.decode(value, { stream: true });
    for (const evt of parseSseChunk(buffer)) {
      if (matcher(evt)) return evt;
    }
  }
  throw new Error(
    `SSE matcher did not fire within ${timeoutMs}ms; buffer: ${buffer.slice(0, 200)}`,
  );
}

function makeMockGate(opts: {
  initialState: BudgetGateState;
  onBump?: (delta_usd: number) => void;
}): BudgetGate & { trigger: () => void; setState: (state: BudgetGateState) => void } {
  let state = opts.initialState;
  const listeners: Array<(event: unknown) => void> = [];
  const gate: BudgetGate = {
    state: () => state,
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    bumpCeiling: (delta_usd) => {
      opts.onBump?.(delta_usd);
      state = {
        ...state,
        ceiling_usd: state.ceiling_usd + delta_usd,
        pressure: state.spent_usd / (state.ceiling_usd + delta_usd),
        status: state.spent_usd / (state.ceiling_usd + delta_usd) < 0.7 ? 'ok' : 'warning',
      };
      for (const l of listeners) l({ type: 'budget.resume' });
    },
    dispose: () => {
      listeners.length = 0;
    },
  };
  return Object.assign(gate, {
    trigger: () => {
      for (const l of listeners) l({ type: 'budget.warning' });
    },
    setState: (next: BudgetGateState) => {
      state = next;
    },
  });
}

describe('registerBudgetRoute — GET /api/budget/sse', () => {
  it('emits a snapshot frame with `state: null` when getGate() returns null', async () => {
    const app = new Hono();
    registerBudgetRoute(app, () => null);
    const res = await app.request('/api/budget/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'budget.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as { state: unknown };
      expect(data.state).toBeNull();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('emits the gate state when wired', async () => {
    const initial: BudgetGateState = {
      spent_usd: 50,
      ceiling_usd: 100,
      pressure: 0.5,
      status: 'ok',
    };
    const gate = makeMockGate({ initialState: initial });
    const app = new Hono();
    registerBudgetRoute(app, () => gate);
    const res = await app.request('/api/budget/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'budget.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as { state: BudgetGateState };
      expect(data.state).toMatchObject({
        spent_usd: 50,
        ceiling_usd: 100,
        pressure: 0.5,
        status: 'ok',
      });
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('re-emits snapshot frame on every gate event (e.g., budget.warning)', async () => {
    const gate = makeMockGate({
      initialState: {
        spent_usd: 0,
        ceiling_usd: 100,
        pressure: 0,
        status: 'ok',
      },
    });
    const app = new Hono();
    registerBudgetRoute(app, () => gate);
    const res = await app.request('/api/budget/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      // Initial snapshot
      await readUntilEvent(reader, (e) => e.event === 'budget.snapshot', 1000);

      // Mutate state + fire event.
      gate.setState({
        spent_usd: 75,
        ceiling_usd: 100,
        pressure: 0.75,
        status: 'warning',
      });
      await new Promise((r) => setTimeout(r, 50));
      gate.trigger();

      const next = await readUntilEvent(
        reader,
        (e) => {
          if (e.event !== 'budget.snapshot') return false;
          const d = JSON.parse(e.data ?? '{}') as { state?: { status?: string } };
          return d.state?.status === 'warning';
        },
        2000,
      );
      const data = JSON.parse(next.data ?? '{}') as { state: BudgetGateState };
      expect(data.state.status).toBe('warning');
      expect(data.state.spent_usd).toBe(75);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});

describe('registerBudgetRoute — POST /api/budget/bump', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when getGate() returns null', async () => {
    const app = new Hono();
    registerBudgetRoute(app, () => null);
    const res = await app.request('/api/budget/bump', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delta_usd: 10 }),
    });
    expect(res.status).toBe(503);
  });

  it('calls gate.bumpCeiling with delta_usd and returns new state', async () => {
    let bumpedDelta = 0;
    const gate = makeMockGate({
      initialState: {
        spent_usd: 96,
        ceiling_usd: 100,
        pressure: 0.96,
        status: 'paused',
      },
      onBump: (d) => {
        bumpedDelta = d;
      },
    });
    const app = new Hono();
    registerBudgetRoute(app, () => gate);
    const res = await app.request('/api/budget/bump', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delta_usd: 50 }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { state: BudgetGateState };
    expect(bumpedDelta).toBe(50);
    expect(data.state.ceiling_usd).toBe(150);
  });

  it('returns 400 for invalid JSON body', async () => {
    const gate = makeMockGate({
      initialState: {
        spent_usd: 0,
        ceiling_usd: 100,
        pressure: 0,
        status: 'ok',
      },
    });
    const app = new Hono();
    registerBudgetRoute(app, () => gate);
    const res = await app.request('/api/budget/bump', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when delta_usd is not a finite number', async () => {
    const gate = makeMockGate({
      initialState: {
        spent_usd: 0,
        ceiling_usd: 100,
        pressure: 0,
        status: 'ok',
      },
    });
    const app = new Hono();
    registerBudgetRoute(app, () => gate);
    for (const body of [{ delta_usd: 'ten' }, { delta_usd: NaN }, { delta_usd: undefined }, {}]) {
      const res = await app.request('/api/budget/bump', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});
