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

import {
  existsSync as fsExistsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readFileSync as fsReadFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
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

  it('Phase 01 Cause A. emits chat.token_usage with provider:openrouter + model:deepseek/deepseek-v3 when TASK_TOKEN_USAGE carries them (route-level lock)', async () => {
    // Mirrors test 4 but with the OpenRouter + DeepSeek pairing the
    // Phase 01 Cause A fix targets. The route-level emit must carry
    // provider:'openrouter' + model:'deepseek/deepseek-v3' through to
    // chat.token_usage so the dashboard reducer can compute the
    // [DeepSeek V3] bracket label (rather than the [Assistant] fallback).
    //
    // Caveat: this test does NOT exercise mapPiEvent → extractGeneric.
    // `makeFakeSession` consumes SwtEvent post-mapping, so the test
    // locks only the route-level emit shape downstream of the extractor.
    // The extractor-direct path is covered by the
    // `extractors.test.ts` unit case `recognises Pi 0.74 bare camelCase
    // variants (...)`.
    const fakeSession = makeFakeSession('sid-openrouter');
    fakeSession.prompt.mockImplementation(async (_text: string) => {
      fakeSession.emit({ type: 'MESSAGE_DELTA', sessionId: 'sid-openrouter', text: 'Hi from DS.' });
      fakeSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-openrouter',
        usage: {
          input: 900,
          output: 150,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'openrouter',
          model: 'deepseek/deepseek-v3',
        },
      });
    });
    const { app } = buildApp({
      authConfig: { openrouter: { mode: 'api_key' } },
      resolveCredentialResult: {
        provider: 'openrouter',
        resolvedCredential: { authMode: 'api_key', secret: 'or-test' },
      },
      createSessionFn: async () => fakeSession,
    });
    const { events } = await postChat(app, { prompt: 'hello deepseek' });
    const tokenEvt = events.find((e) => e.event === 'chat.token_usage');
    expect(tokenEvt).toBeDefined();
    expect(tokenEvt?.data['provider']).toBe('openrouter');
    expect(tokenEvt?.data['model']).toBe('deepseek/deepseek-v3');
    expect(tokenEvt?.data['input']).toBe(900);
    expect(tokenEvt?.data['output']).toBe(150);
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

  it('12. alpha.47 — chat events ARE persisted to .swt-planning/.events/chat-*.jsonl (source contract)', () => {
    // alpha.47 reverses the v1 OQ#2 decision: chat events now dual-emit
    // to (a) bus.publish, (b) streamSSE.writeSSE, AND (c) appendFileSync
    // into `<projectRoot>/.swt-planning/.events/chat-<id>.jsonl`. This
    // static source-file check enforces the contract from the import +
    // call-site side; the round-trip behaviour is covered by the
    // "alpha.47 chat persistence" describe block further down. The
    // string match is robust against future refactors (renaming the
    // path constant, extracting a helper) so long as the route file
    // continues to import node:fs and call appendFileSync somewhere.
    const here = fileURLToPath(import.meta.url);
    const routePath = here.replace(/test\/chat-route\.test\.ts$/, 'src/server/routes/chat.ts');
    const source = readFileSync(routePath, 'utf8');
    const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
    expect(withoutLineComments).toMatch(/appendFileSync/);
    expect(withoutLineComments).toMatch(/from 'node:fs'/);
    // The persisted file path must live under the canonical events dir
    // so the snapshotter's existing chokidar watch + the events-tailer
    // pipeline both pick it up without further wiring.
    expect(withoutLineComments).toMatch(/['"]\.swt-planning['"]/);
    expect(withoutLineComments).toMatch(/['"]\.events['"]/);
    expect(withoutLineComments).toMatch(/chat-\$\{[A-Za-z_]+\}\.jsonl/);
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

  // ─── alpha.38 — Mid-session provider/model switch invalidates cache ──
  it('alpha.38. mid-session Provider dropdown switch disposes the cached session and creates a fresh one against the new provider', async () => {
    // Reproduces the bug: user starts a chat with Anthropic (Opus
    // replies), switches the TopBar Provider dropdown to OpenRouter +
    // Model to DeepSeek, then sends a follow-up. Pre-alpha.38 the
    // follow-up still hit Anthropic because the cached SwtSession from
    // turn 1 had its `AuthStorage` bound to Anthropic and the cache-
    // then-skip-resolve guard at `chat.ts:if (session === undefined)`
    // never re-read `config.providers.strategy`. Post-fix, the route
    // calls `getMatching(id, binding)` BEFORE the cache short-circuit;
    // the binding mismatch disposes the cached session and the second
    // turn flows through createSession with the new provider.
    let nowVal = 0;
    const setIntervalFn = ((_h: () => void, _ms: number) => ({
      __fake__: true,
    })) as unknown as typeof setInterval;
    const clearIntervalFn = (() => undefined) as unknown as typeof clearInterval;
    const registry = new ChatSessionRegistry({
      setIntervalFn,
      clearIntervalFn,
      now: () => nowVal,
    });

    const firstSession = makeFakeSession('sid-anthropic');
    const secondSession = makeFakeSession('sid-openrouter');
    firstSession.prompt.mockImplementation(async () => {
      firstSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-anthropic',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'anthropic',
          model: 'claude-opus-4',
        },
      });
    });
    secondSession.prompt.mockImplementation(async () => {
      secondSession.emit({
        type: 'TASK_TOKEN_USAGE',
        sessionId: 'sid-openrouter',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          turn: 1,
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
        },
      });
    });

    const createdSessions: SwtSession[] = [];
    const createSessionFn = vi.fn(async (_opts: SwtSessionOptions) => {
      const next = createdSessions.length === 0 ? firstSession : secondSession;
      createdSessions.push(next);
      return next;
    });

    // resolveActiveProvider returns a different selection on each call:
    //   turn 1 → anthropic + claude-opus-4
    //   turn 2 → openrouter + deepseek/deepseek-v4-flash
    //   turn 3 → openrouter + deepseek/deepseek-v4-flash  (steady state)
    const selectionsByCall: ActiveProviderSelection[] = [
      {
        provider: 'anthropic',
        authConfig: { anthropic: { mode: 'api_key' } },
        model: 'claude-opus-4',
        source: 'pinned',
      },
      {
        provider: 'openrouter',
        authConfig: { openrouter: { mode: 'api_key' }, anthropic: { mode: 'api_key' } },
        model: 'deepseek/deepseek-v4-flash',
        source: 'pinned',
      },
      {
        provider: 'openrouter',
        authConfig: { openrouter: { mode: 'api_key' }, anthropic: { mode: 'api_key' } },
        model: 'deepseek/deepseek-v4-flash',
        source: 'pinned',
      },
    ];
    let callIdx = 0;
    const resolveActiveProviderFn = vi.fn(() => {
      const sel = selectionsByCall[Math.min(callIdx, selectionsByCall.length - 1)]!;
      callIdx += 1;
      return sel;
    });

    const resolveCredentialFn = vi.fn(async (provider: string) => ({
      provider,
      resolvedCredential: { authMode: 'api_key' as const, secret: 'sk-test' },
    }));

    const { bus } = makeRecordingBus();
    const app = new Hono();
    app.route(
      '/api/chat',
      createChatRoute({
        projectRoot: '/fake-project-root',
        bus,
        registry,
        createSessionFn,
        resolveCredentialFn,
        resolveActiveProviderFn,
      }),
    );

    // Turn 1 — Anthropic. Captures the chat_session_id from chat.start.
    const t1 = await postChat(app, { prompt: 'who are you' });
    const chatSessionId = t1.events.find((e) => e.event === 'chat.start')?.data[
      'chat_session_id'
    ] as string;
    expect(typeof chatSessionId).toBe('string');
    expect(createSessionFn).toHaveBeenCalledTimes(1);
    expect(createSessionFn.mock.calls[0]?.[0]?.provider).toBe('anthropic');
    expect(createSessionFn.mock.calls[0]?.[0]?.model).toBe('claude-opus-4');
    expect(firstSession.prompt).toHaveBeenCalledTimes(1);

    // User switches the TopBar Provider dropdown to OpenRouter AND the
    // Model dropdown to DeepSeek. The `selectionsByCall` table advances
    // resolveActiveProvider to the openrouter row.

    // Turn 2 — same chat_session_id, but a different active provider.
    const t2 = await postChat(app, { prompt: 'who are you now', chat_session_id: chatSessionId });

    // The cached `firstSession` MUST have been disposed by `getMatching`'s
    // binding-mismatch branch (THE FIX).
    expect(firstSession.dispose).toHaveBeenCalledTimes(1);
    // createSession was called AGAIN for the new provider.
    expect(createSessionFn).toHaveBeenCalledTimes(2);
    expect(createSessionFn.mock.calls[1]?.[0]?.provider).toBe('openrouter');
    expect(createSessionFn.mock.calls[1]?.[0]?.model).toBe('deepseek/deepseek-v4-flash');
    // The new session was prompted, the stale one was NOT prompted again.
    expect(secondSession.prompt).toHaveBeenCalledTimes(1);
    expect(firstSession.prompt).toHaveBeenCalledTimes(1);
    // Same chat_session_id surfaces — the binding mismatch reset
    // history but did not invalidate the id.
    const t2_start = t2.events.find((e) => e.event === 'chat.start');
    expect(t2_start?.data['chat_session_id']).toBe(chatSessionId);

    // Turn 3 — same selection as turn 2 (no further switch). The
    // openrouter session must be REUSED, not recreated.
    const t3 = await postChat(app, { prompt: 'and you?', chat_session_id: chatSessionId });
    expect(createSessionFn).toHaveBeenCalledTimes(2); // STILL 2
    expect(secondSession.prompt).toHaveBeenCalledTimes(2);
    expect(secondSession.dispose).not.toHaveBeenCalled();
    const t3_start = t3.events.find((e) => e.event === 'chat.start');
    expect(t3_start?.data['chat_session_id']).toBe(chatSessionId);

    registry.close();
  });

  it('alpha.38. mid-session Model dropdown switch (same provider, different model) also invalidates cache', async () => {
    // Sub-variant: provider stays anthropic but model switches Opus 4 →
    // Sonnet 4. Must also dispose+recreate so Pi's resolved `Model<Api>`
    // is rebuilt for the new id.
    const setIntervalFn = ((_h: () => void, _ms: number) => ({
      __fake__: true,
    })) as unknown as typeof setInterval;
    const clearIntervalFn = (() => undefined) as unknown as typeof clearInterval;
    const registry = new ChatSessionRegistry({
      setIntervalFn,
      clearIntervalFn,
      now: () => 0,
    });

    const opusSession = makeFakeSession('sid-opus');
    const sonnetSession = makeFakeSession('sid-sonnet');
    for (const s of [opusSession, sonnetSession]) {
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
            model: s === opusSession ? 'claude-opus-4' : 'claude-sonnet-4',
          },
        });
      });
    }

    const created: SwtSession[] = [];
    const createSessionFn = vi.fn(async () => {
      const next = created.length === 0 ? opusSession : sonnetSession;
      created.push(next);
      return next;
    });

    const selections: ActiveProviderSelection[] = [
      {
        provider: 'anthropic',
        authConfig: { anthropic: { mode: 'api_key' } },
        model: 'claude-opus-4',
        source: 'pinned',
      },
      {
        provider: 'anthropic',
        authConfig: { anthropic: { mode: 'api_key' } },
        model: 'claude-sonnet-4',
        source: 'pinned',
      },
    ];
    let idx = 0;
    const resolveActiveProviderFn = vi.fn(() => {
      const sel = selections[Math.min(idx, selections.length - 1)]!;
      idx += 1;
      return sel;
    });

    const { bus } = makeRecordingBus();
    const app = new Hono();
    app.route(
      '/api/chat',
      createChatRoute({
        projectRoot: '/fake-project-root',
        bus,
        registry,
        createSessionFn,
        resolveCredentialFn: vi.fn(async (provider: string) => ({
          provider,
          resolvedCredential: { authMode: 'api_key' as const, secret: 'sk-test' },
        })),
        resolveActiveProviderFn,
      }),
    );

    const t1 = await postChat(app, { prompt: 'opus please' });
    const chatSessionId = t1.events.find((e) => e.event === 'chat.start')?.data[
      'chat_session_id'
    ] as string;
    expect(createSessionFn).toHaveBeenCalledTimes(1);
    expect(createSessionFn.mock.calls[0]?.[0]?.model).toBe('claude-opus-4');

    await postChat(app, { prompt: 'sonnet now', chat_session_id: chatSessionId });
    expect(opusSession.dispose).toHaveBeenCalledTimes(1);
    expect(createSessionFn).toHaveBeenCalledTimes(2);
    expect(createSessionFn.mock.calls[1]?.[0]?.model).toBe('claude-sonnet-4');

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

/**
 * alpha.47 — chat transcript persistence + GET /api/chat/history.
 *
 * These tests use a real tmpdir for `projectRoot` so the route's
 * `appendFileSync` lands on disk and the history endpoint can read it
 * back. Confirms the round-trip a user would see across a daemon
 * restart: POST a chat turn → restart (= new Hono app, new registry)
 * → GET /api/chat/history → see the prior turn in the response.
 */
describe('alpha.47 chat persistence + GET /api/chat/history', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildAppWithRealProjectRoot(): {
    app: Hono;
    projectRoot: string;
    bus: EventBus;
    registry: ChatSessionRegistry;
  } {
    const projectRoot = mkdtempSync(nodePath.join(tmpdir(), 'swt-chat-history-'));
    const { bus } = makeRecordingBus();
    const setIntervalFn = ((_h: () => void, _ms: number) => ({
      __fake__: true,
    })) as unknown as typeof setInterval;
    const clearIntervalFn = (() => undefined) as unknown as typeof clearInterval;
    const registry = new ChatSessionRegistry({
      setIntervalFn,
      clearIntervalFn,
      now: () => 0,
    });
    const authConfig: AuthConfig = { anthropic: { mode: 'api_key' } };
    const activeProviderSelection: ActiveProviderSelection = {
      provider: 'anthropic',
      authConfig,
      model: null,
      source: 'first-authed',
    };
    const session = makeFakeSession('persist-sid');
    // Drive a single MESSAGE_DELTA + TASK_TOKEN_USAGE inside prompt() so
    // the on-disk transcript contains a representative chat-* sequence.
    session.prompt.mockImplementation(async () => {
      session.emit({ type: 'MESSAGE_DELTA', text: 'hello back' });
      session.emit({
        type: 'TASK_TOKEN_USAGE',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          provider: 'anthropic',
          model: 'claude-test',
        },
      });
    });
    const routeOpts: ChatRouteOptions = {
      projectRoot,
      bus,
      registry,
      resolveActiveProviderFn: vi.fn(() => activeProviderSelection),
      resolveCredentialFn: vi.fn(async () => ({
        provider: 'anthropic',
        resolvedCredential: { authMode: 'api_key' as const, secret: 'sk-test' },
      })),
      createSessionFn: vi.fn(async () => session),
    };
    const app = new Hono();
    app.route('/api/chat', createChatRoute(routeOpts));
    return { app, projectRoot, bus, registry };
  }

  it('POST /api/chat appends every emitted chat.* event to .swt-planning/.events/chat-<id>.jsonl', async () => {
    const { app, projectRoot } = buildAppWithRealProjectRoot();
    const { status, events } = await postChat(app, { prompt: 'hello' });
    expect(status).toBe(200);
    const chatStart = events.find((e) => e.event === 'chat.start');
    const chatSessionId = chatStart?.data['chat_session_id'] as string;
    expect(typeof chatSessionId).toBe('string');
    const jsonlPath = nodePath.join(
      projectRoot,
      '.swt-planning',
      '.events',
      `chat-${chatSessionId}.jsonl`,
    );
    expect(fsExistsSync(jsonlPath)).toBe(true);
    const lines = fsReadFileSync(jsonlPath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    // chat.start + chat.message_delta + chat.message_end + chat.token_usage + chat.complete = 5 events
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toContain('chat.start');
    expect(types).toContain('chat.message_delta');
    expect(types).toContain('chat.message_end');
    expect(types).toContain('chat.token_usage');
    expect(types).toContain('chat.complete');
  });

  it('GET /api/chat/history returns empty entries when no chat-*.jsonl exists', async () => {
    const { app } = buildAppWithRealProjectRoot();
    const res = await app.request('http://x/api/chat/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it('POST then GET /api/chat/history projects the on-disk transcript into LogEntries (round-trip)', async () => {
    const { app } = buildAppWithRealProjectRoot();
    await postChat(app, { prompt: 'hello' });
    const res = await app.request('http://x/api/chat/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ kind: string; text?: string; chat_session_id: string }>;
    };
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    const kinds = body.entries.map((e) => e.kind);
    expect(kinds).toContain('chat-user');
    expect(kinds).toContain('chat-assistant');
    const userEntry = body.entries.find((e) => e.kind === 'chat-user');
    expect(userEntry?.text).toBe('hello');
    const assistantEntry = body.entries.find((e) => e.kind === 'chat-assistant');
    expect(assistantEntry?.text).toBe('hello back');
  });

  it('history entries are sorted by ts so multi-session files interleave correctly', async () => {
    const { app, projectRoot } = buildAppWithRealProjectRoot();
    // Hand-craft two chat-*.jsonl files with deterministic timestamps so we
    // can assert ordering without relying on Date.now between requests.
    const dir = nodePath.join(projectRoot, '.swt-planning', '.events');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      nodePath.join(dir, 'chat-sid-A.jsonl'),
      JSON.stringify({
        type: 'chat.start',
        ts: '2026-01-01T00:00:01.000Z',
        chat_session_id: 'sid-A',
        prompt: 'first',
      }) + '\n',
    );
    writeFileSync(
      nodePath.join(dir, 'chat-sid-B.jsonl'),
      JSON.stringify({
        type: 'chat.start',
        ts: '2026-01-01T00:00:00.000Z',
        chat_session_id: 'sid-B',
        prompt: 'second-but-earlier',
      }) + '\n',
    );
    const res = await app.request('http://x/api/chat/history');
    const body = (await res.json()) as { entries: Array<{ ts: string; text?: string }> };
    expect(body.entries.length).toBe(2);
    expect(body.entries[0]?.text).toBe('second-but-earlier');
    expect(body.entries[1]?.text).toBe('first');
  });
});
