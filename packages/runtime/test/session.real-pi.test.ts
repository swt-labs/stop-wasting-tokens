/**
 * Real Pi adapter tests (M3 PR-S — session-wiring follow-up).
 *
 * Mocks `@earendil-works/pi-coding-agent` via `vi.mock` so we can assert
 * the adapter wiring without needing real Pi auth / model configuration
 * in CI. Verifies:
 *   - `createSession` calls Pi's `createAgentSession` with the supplied
 *     cwd + the correct sessionManager flavour (`inMemory` vs `create`).
 *   - `session.prompt(text)` calls Pi's `agentSession.prompt(text)`.
 *   - `session.subscribe(listener)` registers a Pi listener; Pi events
 *     flow through `mapPiEvent` and reach the SWT listener.
 *   - `session.dispose()` calls Pi's `agentSession.dispose()`.
 *   - `session.sessionId` reads from Pi's `agentSession.sessionId`.
 *   - `prompt` after `dispose` throws.
 *   - Meter-bridge fan-out still fires on `TASK_TOKEN_USAGE` events.
 *
 * The mock factory captures the args Pi receives + exposes the
 * registered listener callback so tests can emit synthetic Pi events
 * and assert the mapped `SwtEvent` reaches the SWT subscriber.
 */

import type { TokenMeter, MeterRecord } from '@swt-labs/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface MockAgentSession {
  readonly sessionId: string;
  prompt: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

interface MockHarness {
  readonly createAgentSessionCalls: Array<{
    cwd?: string;
    sessionManagerFlavor: 'inMemory' | 'create';
  }>;
  readonly sessions: MockAgentSession[];
  /** Fire a Pi event into the most recent subscribed listener. */
  emitPiEvent(event: unknown): void;
}

function makeMockHarness(): MockHarness {
  const createAgentSessionCalls: Array<{
    cwd?: string;
    sessionManagerFlavor: 'inMemory' | 'create';
  }> = [];
  const sessions: MockAgentSession[] = [];
  let lastListener: ((event: unknown) => void) | undefined;

  vi.doMock('@earendil-works/pi-coding-agent', () => ({
    SessionManager: {
      inMemory: (_cwd?: string) => ({ __flavor: 'inMemory' as const }),
      create: (_cwd: string) => ({ __flavor: 'create' as const }),
    },
    createAgentSession: async (opts: {
      cwd?: string;
      sessionManager?: { __flavor: 'inMemory' | 'create' };
    }) => {
      createAgentSessionCalls.push({
        cwd: opts.cwd,
        sessionManagerFlavor: opts.sessionManager?.__flavor ?? 'create',
      });
      const session: MockAgentSession = {
        sessionId: `pi-session-${sessions.length + 1}`,
        prompt: vi.fn(async (_text: string) => {
          // Pi's prompt is async + may take an options arg; the adapter
          // calls it without options today.
        }),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          lastListener = listener;
          return () => {
            if (lastListener === listener) lastListener = undefined;
          };
        }),
        dispose: vi.fn(),
      };
      sessions.push(session);
      return { session, extensionsResult: { extensions: [], diagnostics: [] } };
    },
  }));

  return {
    createAgentSessionCalls,
    sessions,
    emitPiEvent(event: unknown): void {
      if (lastListener === undefined) {
        throw new Error('emitPiEvent: no listener registered yet');
      }
      lastListener(event);
    },
  };
}

describe('createSession — real Pi adapter (M3 PR-S)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@earendil-works/pi-coding-agent');
  });

  it('returns a SwtSession-shaped object with sessionId from Pi', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({ cwd: '/tmp/swt-real-pi', ephemeral: true });
    expect(session.sessionId).toBe('pi-session-1');
    expect(typeof session.prompt).toBe('function');
    expect(typeof session.subscribe).toBe('function');
    expect(typeof session.dispose).toBe('function');
    expect(harness.createAgentSessionCalls).toHaveLength(1);
    expect(harness.createAgentSessionCalls[0]?.cwd).toBe('/tmp/swt-real-pi');
    expect(harness.createAgentSessionCalls[0]?.sessionManagerFlavor).toBe('inMemory');
  });

  it('uses SessionManager.create when ephemeral is false (persistent)', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({ cwd: '/tmp/swt-persistent', ephemeral: false });
    expect(harness.createAgentSessionCalls[0]?.sessionManagerFlavor).toBe('create');
  });

  it('prompt(text) calls Pi agentSession.prompt(text)', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({ cwd: '/tmp/swt-real-pi', ephemeral: true });
    await session.prompt('hello world');
    expect(harness.sessions[0]?.prompt).toHaveBeenCalledWith('hello world');
  });

  it('subscribe relays mapped Pi events through to the SWT listener', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({ cwd: '/tmp/swt-real-pi', ephemeral: true });
    const received: Array<{ type: string }> = [];
    session.subscribe((event) => {
      received.push({ type: event.type });
    });

    // Emit a Pi `agent_start` event — mapPiEvent maps it to `AGENT_START`.
    harness.emitPiEvent({ type: 'agent_start' });
    expect(received).toEqual([{ type: 'AGENT_START' }]);

    // Emit a `message_update` with delta text → MESSAGE_DELTA.
    harness.emitPiEvent({ type: 'message_update', delta: { text: 'partial response' } });
    expect(received).toEqual([{ type: 'AGENT_START' }, { type: 'MESSAGE_DELTA' }]);

    // Emit something mapPiEvent ignores (e.g., `compaction_start`) — no fan-out.
    harness.emitPiEvent({ type: 'compaction_start' });
    expect(received).toHaveLength(2);
  });

  it('meter bridge fires on TASK_TOKEN_USAGE events via the real adapter', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const records: MeterRecord[] = [];
    const meter: TokenMeter = {
      record(record: MeterRecord, _cost: number) {
        records.push(record);
      },
      snapshot: () => ({
        records: [],
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      subscribe: () => () => undefined,
    };

    const session = await createSession({
      cwd: '/tmp/swt-real-pi',
      ephemeral: true,
      meter,
      meterContext: {
        milestone: 'M3',
        phase: '03',
        task_id: 'T-real-001',
        role: 'dev',
        tier: 'balanced',
      },
    });
    // Subscribe a no-op SWT listener so the inner Pi listener registers.
    session.subscribe(() => undefined);

    // Emit a Pi `turn_end` carrying anthropic usage; mapPiEvent →
    // TASK_TOKEN_USAGE; meter bridge records the row.
    harness.emitPiEvent({
      type: 'turn_end',
      turn: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      message: {
        usage: {
          input_tokens: 1200,
          output_tokens: 340,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.task_id).toBe('T-real-001');
    expect(records[0]?.role).toBe('dev');
    expect(records[0]?.input).toBe(1200);
    expect(records[0]?.output).toBe(340);
  });

  it('dispose() calls Pi agentSession.dispose() and rejects further prompts', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({ cwd: '/tmp/swt-real-pi', ephemeral: true });
    session.dispose();
    expect(harness.sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    await expect(session.prompt('after dispose')).rejects.toThrow(/after dispose/);
  });

  it('dispose() is idempotent — second call does not re-fire Pi dispose', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({ cwd: '/tmp/swt-real-pi', ephemeral: true });
    session.dispose();
    session.dispose();
    expect(harness.sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});
