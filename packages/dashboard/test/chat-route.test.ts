// Manual end-to-end check (post-merge, with daemon running):
//   curl -N -X POST http://localhost:54321/api/chat \
//     -H 'content-type: application/json' \
//     -d '{"prompt":"Hello, who are you"}'
// Expected SSE event sequence:
//   event: chat.start          data: {"type":"chat.start", ...}
//   event: chat.message_delta  (one or more, streamed live)
//   event: chat.message_end
//   event: chat.token_usage
//   event: chat.complete
// Multi-turn:
//   curl -N -X POST http://localhost:54321/api/chat \
//     -H 'content-type: application/json' \
//     -d '{"prompt":"What did I just ask?","chat_session_id":"<paste from chat.start of prior call>"}'
// The reply should reference the prior turn — confirming Pi's
// SessionManager.inMemory is accumulating history natively.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  ActiveProviderSelection,
  AuthConfig,
  SwtEvent,
  SwtSession,
  SwtSessionOptions,
} from '@swt-labs/runtime';
import { SNAPSHOT_EVENT_TYPES } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatSessionRegistry } from '../src/server/chat-session-registry.js';
import type { EventBus } from '../src/server/event-bus.js';
import { createChatRoute, type ChatRouteOptions } from '../src/server/routes/chat.js';

/**
 * Plan 01-03 P04 — Integration tests for the POST /api/chat SSE route.
 *
 * Uses Hono's in-process `app.request(...)` so we never bind a real port
 * + never touch the real `@swt-labs/runtime` substrate (createSession,
 * resolveSpawnCredential, readProjectAuthConfig are all seamed via
 * `ChatRouteOptions`). SSE responses are parsed by splitting on `\n\n`
 * and pulling the `event:` + `data:` lines.
 */

interface ParsedSseEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

function parseSseEvents(text: string): ParsedSseEvent[] {
  const out: ParsedSseEvent[] = [];
  // SSE frame separator is a blank line. Both `\r\n\r\n` and `\n\n` are
  // valid per the spec; Hono uses `\n\n`. Be tolerant.
  const frames = text.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    if (frame.trim().length === 0) continue;
    let event = 'message';
    let dataLine = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataLine += line.slice('data:'.length).trim();
    }
    if (dataLine.length === 0) {
      // keep-alive frames carry `data:` with empty body; skip from
      // assertion sequences.
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataLine) as Record<string, unknown>;
    } catch {
      continue;
    }
    out.push({ event, data: parsed });
  }
  return out;
}

/**
 * A test-double for `SwtSession`. Tests trigger Pi-side events through
 * the captured listener via `emit(evt)` so the route's subscription
 * callback fires synchronously during the awaited `prompt()` call.
 */
interface FakeSession extends SwtSession {
  readonly prompt: ReturnType<typeof vi.fn>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  emit(evt: SwtEvent): void;
  readonly events: SwtEvent[];
}

function makeFakeSession(sessionId = 'fake-sid'): FakeSession {
  const listeners: Array<(evt: SwtEvent) => void> = [];
  const events: SwtEvent[] = [];
  const session: FakeSession = {
    sessionId,
    prompt: vi.fn(async (_text: string) => undefined),
    subscribe: vi.fn((listener: (evt: SwtEvent) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    dispose: vi.fn(),
    emit(evt: SwtEvent): void {
      events.push(evt);
      for (const l of listeners) l(evt);
    },
    events,
  };
  return session;
}

/** Cheap in-memory EventBus that records every publish. */
function makeRecordingBus(): { bus: EventBus; published: Array<{ type: string }> } {
  const published: Array<{ type: string }> = [];
  const listeners = new Set<Parameters<EventBus['subscribe']>[0]>();
  const bus: EventBus = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      published.push(event);
      for (const l of listeners) l(event);
    },
    size() {
      return listeners.size;
    },
  };
  return { bus, published };
}

/**
 * Build a chat-route Hono app with the supplied seams. A fresh
 * `ChatSessionRegistry` is constructed with a seamed setInterval so the
 * sweep does not fire on real timers during the test.
 */
interface BuildAppArgs {
  authConfig?: AuthConfig;
  /**
   * The resolveCredential result. Pass an object for success, `null`
   * for "explicit miss" (resolveCredential returns undefined), or
   * omit entirely for the default api_key happy-path stub.
   */
  resolveCredentialResult?: {
    provider: string;
    resolvedCredential: { authMode: 'api_key' | 'oauth'; secret: string };
  } | null;
  createSessionFn?: (opts: SwtSessionOptions) => Promise<SwtSession>;
  registry?: ChatSessionRegistry;
  now?: () => number;
}

function buildApp(args: BuildAppArgs = {}): {
  app: Hono;
  bus: EventBus;
  published: Array<{ type: string }>;
  registry: ChatSessionRegistry;
  createSessionFn: ReturnType<typeof vi.fn>;
  resolveCredentialFn: ReturnType<typeof vi.fn>;
  resolveActiveProviderFn: ReturnType<typeof vi.fn>;
} {
  const { bus, published } = makeRecordingBus();
  const setIntervalFn = ((_h: () => void, _ms: number) => ({
    __fake__: true,
  })) as unknown as typeof setInterval;
  const clearIntervalFn = (() => undefined) as unknown as typeof clearInterval;
  const registry =
    args.registry ??
    new ChatSessionRegistry({
      setIntervalFn,
      clearIntervalFn,
      now: args.now ?? (() => 0),
    });
  const authConfig: AuthConfig = args.authConfig ?? { anthropic: { mode: 'api_key' } };
  // alpha.37 — the chat route now uses `resolveActiveProvider` (which
  // returns BOTH the auth block AND the pinned-or-first-authed provider
  // id + the model from `config.model`) instead of `readProjectAuthConfig`
  // + `Object.keys(authConfig)[0]`. Synthesize a selection from the test's
  // `authConfig` arg so existing assertions continue to work; the
  // first-authed fallback path matches the pre-alpha.37 behaviour the
  // tests originally exercised.
  const authKeys = Object.keys(authConfig);
  const activeProviderSelection: ActiveProviderSelection = {
    provider: authKeys[0] ?? null,
    authConfig,
    model: null,
    source: authKeys.length > 0 ? 'first-authed' : 'none',
  };
  // `null` sentinel → resolveCredential returns undefined (explicit miss).
  // Omitted → default api_key happy-path stub.
  const resolveCredentialResult =
    args.resolveCredentialResult === null
      ? undefined
      : (args.resolveCredentialResult ?? {
          provider: 'anthropic',
          resolvedCredential: { authMode: 'api_key' as const, secret: 'sk-test' },
        });

  const resolveActiveProviderFn = vi.fn(() => activeProviderSelection);
  const resolveCredentialFn = vi.fn(async () => resolveCredentialResult);
  const createSessionFn = vi.fn(args.createSessionFn ?? (async () => makeFakeSession()));

  const routeOpts: ChatRouteOptions = {
    projectRoot: '/fake-project-root',
    bus,
    registry,
    createSessionFn,
    resolveCredentialFn,
    resolveActiveProviderFn,
  };

  const app = new Hono();
  app.route('/api/chat', createChatRoute(routeOpts));

  return {
    app,
    bus,
    published,
    registry,
    createSessionFn,
    resolveCredentialFn,
    resolveActiveProviderFn,
  };
}

/** Convenience helper that runs the request, parses SSE, returns events. */
async function postChat(
  app: Hono,
  body: Record<string, unknown>,
): Promise<{ status: number; events: ParsedSseEvent[]; bodyText: string }> {
  const res = await app.request('http://x/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const bodyText = await res.text();
  return { status: res.status, events: parseSseEvents(bodyText), bodyText };
}

describe('POST /api/chat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. rejects empty prompt with synchronous 400 (no SSE stream opened)', async () => {
    const { app, createSessionFn, resolveActiveProviderFn } = buildApp();
    const res = await app.request('http://x/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('CHAT_INVALID_REQUEST');
    expect(createSessionFn).not.toHaveBeenCalled();
    expect(resolveActiveProviderFn).not.toHaveBeenCalled();

    // Whitespace-only also rejected
    const res2 = await app.request('http://x/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });
    expect(res2.status).toBe(400);
  });

  it('2. no auth block configured → chat.error CHAT_AUTH_FAILED + chat.complete (no chat.start)', async () => {
    const { app, createSessionFn } = buildApp({ authConfig: {} });
    const { events } = await postChat(app, { prompt: 'hello' });
    expect(events.map((e) => e.event)).toEqual(['chat.error', 'chat.complete']);
    expect(events[0]?.data['code']).toBe('CHAT_AUTH_FAILED');
    expect(createSessionFn).not.toHaveBeenCalled();
  });

  it('3. resolveCredential returns undefined → chat.error CHAT_AUTH_FAILED + chat.complete', async () => {
    const { app, createSessionFn } = buildApp({
      resolveCredentialResult: null, // sentinel — see BuildAppArgs JSDoc
    });
    const { events } = await postChat(app, { prompt: 'hello' });
    expect(events.map((e) => e.event)).toEqual(['chat.error', 'chat.complete']);
    expect(events[0]?.data['code']).toBe('CHAT_AUTH_FAILED');
    expect(createSessionFn).not.toHaveBeenCalled();
  });

  it('4. happy path API-key — emits chat.start → message_delta × 2 → token_usage → message_end → complete', async () => {
    const fakeSession = makeFakeSession('sid-happy');
    fakeSession.prompt.mockImplementation(async (_text: string) => {
      fakeSession.emit({ type: 'MESSAGE_DELTA', sessionId: 'sid-happy', text: 'Hello, ' });
      fakeSession.emit({ type: 'MESSAGE_DELTA', sessionId: 'sid-happy', text: 'world!' });
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-happy',
        usage: {
          input: 5,
          output: 7,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app } = buildApp({
      createSessionFn: async () => fakeSession,
    });
    const { events } = await postChat(app, { prompt: 'hi' });
    expect(events.map((e) => e.event)).toEqual([
      'chat.start',
      'chat.message_delta',
      'chat.message_delta',
      'chat.token_usage',
      'chat.message_end',
      'chat.complete',
    ]);
    expect(events[0]?.data['prompt']).toBe('hi');
    expect(events[1]?.data['text']).toBe('Hello, ');
    expect(events[2]?.data['text']).toBe('world!');
    expect(events[3]?.data['provider']).toBe('anthropic');
    expect(events[3]?.data['model']).toBe('claude-sonnet-4');
    expect(events[3]?.data['input']).toBe(5);
    expect(events[3]?.data['output']).toBe(7);
  });

  it('5. OAuth credential path — createSessionFn is called with authMode oauth', async () => {
    let capturedOpts: SwtSessionOptions | undefined;
    const fakeSession = makeFakeSession('sid-oauth');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-oauth',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app, createSessionFn } = buildApp({
      resolveCredentialResult: {
        provider: 'anthropic',
        resolvedCredential: { authMode: 'oauth', secret: '{"accessToken":"oauth-blob"}' },
      },
      createSessionFn: async (opts) => {
        capturedOpts = opts;
        return fakeSession;
      },
    });
    const { events } = await postChat(app, { prompt: 'hi via oauth' });
    expect(createSessionFn).toHaveBeenCalledTimes(1);
    expect(capturedOpts?.resolvedCredential?.authMode).toBe('oauth');
    expect(capturedOpts?.provider).toBe('anthropic');
    expect(capturedOpts?.ephemeral).toBe(true);
    expect(events.map((e) => e.event)).toContain('chat.complete');
  });

  it('6. TOOL_CALL event passes through as chat.tool_call', async () => {
    const fakeSession = makeFakeSession('sid-tool');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({ type: 'TOOL_CALL', sessionId: 'sid-tool', name: 'Read' });
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-tool',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app } = buildApp({ createSessionFn: async () => fakeSession });
    const { events } = await postChat(app, { prompt: 'list files' });
    const toolEvt = events.find((e) => e.event === 'chat.tool_call');
    expect(toolEvt).toBeDefined();
    expect(toolEvt?.data['tool']).toBe('Read');
  });

  it('7. multi-turn — same chat_session_id reuses session (createSession called 1×, prompt called 2× on same instance)', async () => {
    const fakeSession = makeFakeSession('sid-mt');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-mt',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app, createSessionFn } = buildApp({
      createSessionFn: async () => fakeSession,
    });

    // First POST without chat_session_id — captures the assigned id
    // from the chat.start event.
    const first = await postChat(app, { prompt: 'turn 1' });
    expect(createSessionFn).toHaveBeenCalledTimes(1);
    expect(fakeSession.prompt).toHaveBeenCalledTimes(1);
    const startEvt = first.events.find((e) => e.event === 'chat.start');
    const chatSessionId = startEvt?.data['chat_session_id'] as string;
    expect(typeof chatSessionId).toBe('string');
    expect(chatSessionId.length).toBeGreaterThan(0);

    // Second POST with the SAME chat_session_id must reuse the session.
    const second = await postChat(app, {
      prompt: 'turn 2',
      chat_session_id: chatSessionId,
    });
    expect(createSessionFn).toHaveBeenCalledTimes(1); // STILL 1
    expect(fakeSession.prompt).toHaveBeenCalledTimes(2);
    // alpha.35 fix: chat route passes streamingBehavior='followUp' so a
    // second back-to-back prompt queues instead of throwing Pi's
    // "Agent is already processing" error. Assertion updated to match.
    expect(fakeSession.prompt).toHaveBeenNthCalledWith(2, 'turn 2', {
      streamingBehavior: 'followUp',
    });
    // Same id surfaces on the second chat.start
    const second_start = second.events.find((e) => e.event === 'chat.start');
    expect(second_start?.data['chat_session_id']).toBe(chatSessionId);
  });

  it('8. multi-turn — POSTs without chat_session_id create NEW sessions per turn', async () => {
    const sessions: FakeSession[] = [];
    const { app, createSessionFn } = buildApp({
      createSessionFn: async () => {
        const s = makeFakeSession(`sid-${sessions.length}`);
        s.prompt.mockImplementation(async () => {
          s.emit({
            type: 'TASK_TOKEN_USAGE',
            sessionId: s.sessionId,
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              turn: 1,
              provider: 'anthropic',
              model: 'claude-sonnet-4',
            },
          });
        });
        sessions.push(s);
        return s;
      },
    });

    const first = await postChat(app, { prompt: 'one' });
    const second = await postChat(app, { prompt: 'two' });
    expect(createSessionFn).toHaveBeenCalledTimes(2);
    const id1 = first.events.find((e) => e.event === 'chat.start')?.data['chat_session_id'];
    const id2 = second.events.find((e) => e.event === 'chat.start')?.data['chat_session_id'];
    expect(id1).not.toBe(id2);
  });

  it('9. TASK_ERROR mid-turn → chat.error CHAT_SESSION_ERROR + chat.complete (no chat.message_end)', async () => {
    const fakeSession = makeFakeSession('sid-err');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({
        type: 'TASK_ERROR',
        sessionId: 'sid-err',
        errorMessage: 'Provider rate-limited',
      });
    });
    const { app } = buildApp({ createSessionFn: async () => fakeSession });
    const { events } = await postChat(app, { prompt: 'fail' });
    const types = events.map((e) => e.event);
    expect(types).toContain('chat.start');
    expect(types).toContain('chat.error');
    expect(types).not.toContain('chat.message_end');
    expect(types[types.length - 1]).toBe('chat.complete');
    const errEvt = events.find((e) => e.event === 'chat.error');
    expect(errEvt?.data['code']).toBe('CHAT_SESSION_ERROR');
    expect(errEvt?.data['message']).toBe('Provider rate-limited');
  });

  it('10. session.prompt() throws → chat.error CHAT_PROMPT_ERROR + chat.complete', async () => {
    const fakeSession = makeFakeSession('sid-throw');
    fakeSession.prompt.mockRejectedValue(new Error('boom'));
    const { app } = buildApp({ createSessionFn: async () => fakeSession });
    const { events } = await postChat(app, { prompt: 'crash' });
    const types = events.map((e) => e.event);
    expect(types).toContain('chat.error');
    expect(types[types.length - 1]).toBe('chat.complete');
    const errEvt = events.find((e) => e.event === 'chat.error');
    expect(errEvt?.data['code']).toBe('CHAT_PROMPT_ERROR');
    expect(errEvt?.data['message']).toBe('boom');
  });

  it('11. bus.publish is called in parallel with SSE writes (telemetry parity)', async () => {
    const fakeSession = makeFakeSession('sid-bus');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({ type: 'MESSAGE_DELTA', sessionId: 'sid-bus', text: 'hi' });
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-bus',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app, published } = buildApp({ createSessionFn: async () => fakeSession });
    const { events } = await postChat(app, { prompt: 'hi' });
    // Every SSE event type appears in the bus publish log (order matches).
    const sseTypes = events.map((e) => e.event);
    const busTypes = published.map((p) => p.type);
    expect(busTypes).toEqual(sseTypes);
  });

  it('12. NO JSONL file emit on the chat path (source has no appendFileSync / no node:fs import)', () => {
    // Per Lead's OQ#2 decision: chat events go to bus.publish + SSE only,
    // NEVER to a `.swt-planning/.events/chat-*.jsonl` file. Asserting via
    // a static source-file check is more robust than `vi.spyOn(fs, ...)`
    // (which fails on ESM's non-configurable named exports) and catches
    // both the direct-call and the import paths a future contributor
    // might use.
    const here = fileURLToPath(import.meta.url);
    // here = .../packages/dashboard/test/chat-route.test.ts
    const routePath = here.replace(/test\/chat-route\.test\.ts$/, 'src/server/routes/chat.ts');
    const source = readFileSync(routePath, 'utf8');
    // The route MUST NOT call appendFileSync or import node:fs — bus.publish
    // + streamSSE are the only emit channels. The JSDoc may mention these
    // strings in prose, so we strip block comments before asserting.
    const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
    expect(withoutLineComments).not.toMatch(/appendFileSync/);
    expect(withoutLineComments).not.toMatch(/from 'node:fs'/);
    expect(withoutLineComments).not.toMatch(/from "node:fs"/);
  });

  // ─── P05 — End-to-end smoke + regression alignment ────────────────────

  it('E2E. two POSTs with the same id reuse the registry handle; TTL sweep then disposes it', async () => {
    // Drives the full lifecycle through a REAL ChatSessionRegistry (no
    // mock seam on `get`/`set`) with only the timer + clock + session
    // factory stubbed. Proves the route + registry composition holds:
    //   (a) first POST registers a session (size === 1)
    //   (b) second POST with the same id reuses (size still 1)
    //   (c) advancing time past TTL + driving the sweep disposes the
    //       session and clears the registry (size === 0).
    let nowVal = 0;
    const ttlMs = 1000;
    const { setIntervalFn, clearIntervalFn, fireSweep } = (() => {
      const registered: Array<{ handler: () => void; ms: number }> = [];
      const setIntervalFn = ((handler: () => void, ms: number) => {
        registered.push({ handler, ms });
        return { __fake__: true };
      }) as unknown as typeof setInterval;
      const clearIntervalFn = (() => undefined) as typeof clearInterval;
      return {
        setIntervalFn,
        clearIntervalFn,
        fireSweep: () => {
          registered[0]?.handler();
        },
      };
    })();
    const registry = new ChatSessionRegistry({
      ttlMs,
      setIntervalFn,
      clearIntervalFn,
      now: () => nowVal,
    });
    const fakeSession = makeFakeSession('sid-e2e');
    fakeSession.prompt.mockImplementation(async () => {
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-e2e',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        },
      });
    });
    const { app } = buildApp({ registry, createSessionFn: async () => fakeSession });

    const first = await postChat(app, { prompt: 'one' });
    expect(registry.size()).toBe(1);
    const startEvt = first.events.find((e) => e.event === 'chat.start');
    const chatSessionId = startEvt?.data['chat_session_id'] as string;
    expect(typeof chatSessionId).toBe('string');
    expect(chatSessionId.length).toBeGreaterThan(0);

    await postChat(app, { prompt: 'two', chat_session_id: chatSessionId });
    expect(registry.size()).toBe(1); // STILL 1 — handle reused
    expect(fakeSession.prompt).toHaveBeenCalledTimes(2);

    // Advance time past TTL + drive the sweep. The registry should
    // dispose the session exactly once.
    nowVal = ttlMs + 1;
    fireSweep();
    expect(registry.size()).toBe(0);
    expect(fakeSession.dispose).toHaveBeenCalledTimes(1);

    registry.close();
  });

  it('REGRESSION. SNAPSHOT_EVENT_TYPES carries every chat.* type the route emits', () => {
    // Locked-down list of every `chat.*` literal this route can write
    // through `stream.writeSSE({event: evt.type, ...})`. If a future
    // refactor adds a new chat event variant to the Zod union but
    // forgets to extend SNAPSHOT_EVENT_TYPES (the runtime-introspection
    // array), bus.publish + the dashboard SSE filter will silently
    // drop the new event. This test fails loudly when that happens.
    const expected = [
      'chat.start',
      'chat.message_delta',
      'chat.tool_call',
      'chat.message_end',
      'chat.token_usage',
      'chat.error',
      'chat.complete',
    ];
    for (const t of expected) {
      expect(SNAPSHOT_EVENT_TYPES).toContain(t);
    }
  });
});
