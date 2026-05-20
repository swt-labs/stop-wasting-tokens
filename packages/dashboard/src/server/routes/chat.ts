/**
 * Plan 01-03 (milestone 12, Phase 01) — `POST /api/chat` SSE route.
 *
 * Powers the dashboard's Free-talk Mode. The route returns a `streamSSE`
 * response directly from the handler (single-endpoint design — Lead
 * decision on Scout Open Question #3). On the first POST with no
 * `chat_session_id`, it resolves a credential via `@swt-labs/runtime`,
 * creates an ephemeral `SwtSession` via `createSession`, and registers
 * it in the injected `ChatSessionRegistry`. Subsequent POSTs with the
 * same `chat_session_id` reuse the registered session — Pi's
 * `SessionManager.inMemory` accumulates conversation history natively
 * (Scout RESEARCH §Q3), so multi-turn "just works" by calling
 * `session.prompt(text)` on the same handle.
 *
 * **alpha.38 — Mid-session provider/model switch invalidates the cache.**
 * Before every registry lookup the route calls `resolveActiveProvider`
 * to read the current `(provider, model)` pin from
 * `.swt-planning/config.json` and uses `registry.getMatching(id, binding)`
 * — which disposes-and-returns-undefined when the cached entry's stamped
 * binding differs. The route then falls through to the
 * `resolveCredential` + `createSession` path with the freshly-pinned
 * provider + model. Conversation history is reset by definition (the
 * cached Pi `AgentSession` is disposed), which matches the user's
 * mental model when they explicitly switch vendors mid-chat. Pre-fix
 * (alpha.37), the cache-then-skip-resolve guard at
 * `if (session === undefined)` silently ignored mid-session switches —
 * the TopBar dropdown + statusline reflected the new provider, but
 * every turn kept replying through the first-turn vendor.
 *
 * **Event mapping (per @swt-labs/shared Zod schemas):**
 *   Pi `MESSAGE_DELTA`          → `chat.message_delta`
 *   Pi `TOOL_CALL`              → `chat.tool_call`
 *   Pi `TASK_TOKEN_USAGE`       → `chat.token_usage`
 *   Pi `TASK_ERROR`             → `chat.error {code: CHAT_SESSION_ERROR}`
 *   `session.prompt()` throws   → `chat.error {code: CHAT_PROMPT_ERROR}`
 *   missing credential          → `chat.error {code: CHAT_AUTH_FAILED}`
 *   turn-end (clean)            → `chat.message_end` + `chat.complete`
 *   turn-end (any error)        → `chat.error` + `chat.complete`
 *
 * `AGENT_START` / `AGENT_END` / `TOOL_RESULT` Pi events are intentionally
 * filtered — v1 chat UI doesn't need them; a future plan can add new
 * event variants if telemetry/UX asks.
 *
 * **No JSONL dual-emit (Lead decision on Scout Open Question #2):**
 * `bus.publish()` runs in parallel with `stream.writeSSE` for live
 * telemetry parity (so other dashboard subscribers see chat events too),
 * but no `.swt-planning/.events/chat-*.jsonl` file is written. Chat
 * history is in-memory only in v1; a reconnecting client starts a new
 * chat session.
 *
 * **Empty prompt is a synchronous 400 BEFORE headers fly** — Hono's
 * `streamSSE` makes it awkward to surface a clean error response after
 * SSE headers are written, so we fail fast on the validation path.
 *
 * **Session disposal:** the registry owns lifetime. The route never
 * disposes the SwtSession in the request `finally` — that would break
 * multi-turn handle reuse. TTL sweep + `registry.close()` handle
 * cleanup.
 *
 * **Pi 0.74 constraint:** no `systemPrompt` option on `createAgentSession`.
 * Chat has no role prompt anyway (it's plain prompt+response, no
 * orchestrator, no `swt_*` extensions — REQ-07 / milestone-12 scope), so
 * direct `session.prompt(text)` is the correct call.
 */

import { randomUUID } from 'node:crypto';

import {
  createSession as defaultCreateSession,
  resolveActiveProvider as defaultResolveActiveProvider,
  resolveSpawnCredential as defaultResolveSpawnCredential,
  type SwtEvent,
  type SwtSession,
} from '@swt-labs/runtime';
import type {
  ChatCompleteEvent,
  ChatErrorEvent,
  ChatMessageDeltaEvent,
  ChatMessageEndEvent,
  ChatStartEvent,
  ChatTokenUsageEvent,
  ChatToolCallEvent,
} from '@swt-labs/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { ChatSessionRegistry } from '../chat-session-registry.js';
import type { EventBus } from '../event-bus.js';

/** Union of every `chat.*` event the route emits. Subset of `SnapshotEvent`. */
type ChatSseEvent =
  | ChatStartEvent
  | ChatMessageDeltaEvent
  | ChatToolCallEvent
  | ChatMessageEndEvent
  | ChatTokenUsageEvent
  | ChatErrorEvent
  | ChatCompleteEvent;

export interface ChatRouteOptions {
  /** Absolute project root — `.swt-planning/config.json` is read from here. */
  projectRoot: string;
  /** Event-bus seam: every emitted chat.* event is also published here. */
  bus: EventBus;
  /** Owns the SwtSession handles across turns + TTL-sweeps idle ones. */
  registry: ChatSessionRegistry;
  /** Test seam — defaults to `@swt-labs/runtime`'s `createSession`. */
  createSessionFn?: typeof defaultCreateSession;
  /** Test seam — defaults to `@swt-labs/runtime`'s `resolveSpawnCredential`. */
  resolveCredentialFn?: typeof defaultResolveSpawnCredential;
  /**
   * Test seam — defaults to `@swt-labs/runtime`'s `resolveActiveProvider`.
   * alpha.37 replacement for the previous `readAuthConfigFn` seam: the chat
   * route now needs BOTH the auth block AND the pinned provider id (from
   * `providers.strategy.provider`), and `resolveActiveProvider` returns
   * both with one config.json read.
   */
  resolveActiveProviderFn?: typeof defaultResolveActiveProvider;
}

interface ChatPostBody {
  prompt?: unknown;
  chat_session_id?: unknown;
}

/**
 * Factory mirroring `registerInitRoute`'s `?? defaults` pattern. Returns
 * a self-contained Hono app so the caller mounts it via
 * `app.route('/api/chat', createChatRoute({...}))`.
 */
export function createChatRoute(opts: ChatRouteOptions): Hono {
  const app = new Hono();
  const createSession = opts.createSessionFn ?? defaultCreateSession;
  const resolveCredential = opts.resolveCredentialFn ?? defaultResolveSpawnCredential;
  const resolveActiveProvider = opts.resolveActiveProviderFn ?? defaultResolveActiveProvider;

  app.post('/', async (c) => {
    const raw = (await c.req.json<ChatPostBody>().catch(() => ({}))) as ChatPostBody;
    const promptCandidate = typeof raw.prompt === 'string' ? raw.prompt : '';
    const prompt = promptCandidate.trim();
    const requestedId =
      typeof raw.chat_session_id === 'string' && raw.chat_session_id.length > 0
        ? raw.chat_session_id
        : undefined;

    // Synchronous 400 BEFORE opening the SSE stream — see file header.
    if (prompt.length === 0) {
      return c.json(
        { error: 'CHAT_INVALID_REQUEST', message: 'prompt is required and must be non-empty' },
        400,
      );
    }

    const chatSessionId = requestedId ?? randomUUID();

    return streamSSE(c, async (stream) => {
      const ts = (): string => new Date().toISOString();

      /**
       * Emit a chat.* event to BOTH the bus (telemetry parity) and the
       * SSE stream (the live channel the dashboard subscribes to).
       */
      const emit = async (evt: ChatSseEvent): Promise<void> => {
        try {
          opts.bus.publish(evt);
        } catch {
          // Bus listeners that throw are already swallowed by the bus
          // implementation; this catch is defense-in-depth.
        }
        try {
          await stream.writeSSE({ event: evt.type, data: JSON.stringify(evt) });
        } catch {
          // Stream-write errors (e.g., client disconnected mid-turn) must
          // not crash the daemon. The session.subscribe() callback will
          // also stop emitting once unsubscribe() runs in the finally block.
        }
      };

      // alpha.38 fix — resolve the active provider + model BEFORE the
      // registry lookup so the cache-then-skip-resolve path can no longer
      // bypass a mid-session TopBar Provider/Model switch. Pre-fix
      // (alpha.37), the route used `opts.registry.get(chatSessionId)` and
      // short-circuited around `resolveActiveProvider` whenever a session
      // was already registered — which meant turn-1's `(provider, model)`
      // binding stuck for every subsequent turn even after the user
      // switched dropdowns. `resolveActiveProvider` reads
      // `.swt-planning/config.json` on EVERY call (no in-process cache),
      // so doing the resolve up front is cheap and now drives both the
      // first-turn create path AND the multi-turn staleness check.
      //
      // alpha.37 comment (still applies): `resolveActiveProvider` honors
      // `providers.strategy.provider` first, falls back to the first
      // authed entry when no pin, AND returns `model` from `config.model`
      // (alpha.35 Model dropdown) so it can flow through to Pi's
      // `createAgentSession({model})` via `createSession({model})`.
      const selection = resolveActiveProvider(opts.projectRoot);
      if (selection.provider === null) {
        await emit({
          type: 'chat.error',
          ts: ts(),
          chat_session_id: chatSessionId,
          code: 'CHAT_AUTH_FAILED',
          message:
            'No auth block configured for this project. Run `swt init` or open the dashboard Provider settings.',
        });
        await emit({ type: 'chat.complete', ts: ts(), chat_session_id: chatSessionId });
        return;
      }

      // alpha.38 — stamp the registry entry with the resolved
      // `(provider, model)` so a mid-session dropdown switch invalidates
      // the cached session. `getMatching` disposes-and-returns-undefined
      // on a binding mismatch; the route then falls through to the
      // create-new-session branch below. Conversation history (Pi's
      // `SessionManager.inMemory`) is reset by definition because the
      // cached AgentSession is disposed — which matches the user's
      // mental model when they explicitly switch vendors mid-chat.
      const binding = { provider: selection.provider, model: selection.model };

      // First, try to reuse a session by id. We only reuse when the client
      // explicitly sent a `chat_session_id` — a fresh randomUUID() can't
      // possibly match an existing entry, so skip the lookup to keep the
      // create-path linear when no id is provided.
      let session: SwtSession | undefined =
        requestedId !== undefined ? opts.registry.getMatching(chatSessionId, binding) : undefined;
      let unsubscribe: (() => void) | undefined;

      try {
        if (session === undefined) {
          // ─── First turn for this chat_session_id OR cached entry was
          // invalidated by a provider/model switch (alpha.38) ───────────
          const resolved = await resolveCredential(selection.provider, selection.authConfig);
          if (resolved === undefined) {
            await emit({
              type: 'chat.error',
              ts: ts(),
              chat_session_id: chatSessionId,
              code: 'CHAT_AUTH_FAILED',
              message: `Could not resolve credential for provider '${selection.provider}'. Check the OS keychain or environment fallback.`,
            });
            await emit({ type: 'chat.complete', ts: ts(), chat_session_id: chatSessionId });
            return;
          }

          session = await createSession({
            cwd: opts.projectRoot,
            ephemeral: true,
            provider: resolved.provider,
            resolvedCredential: resolved.resolvedCredential,
            // alpha.37 — forward `config.model` to Pi. session.ts resolves
            // it to a `Model<any>` via `ModelRegistry.find(provider, id)`;
            // when the id isn't in the registry Pi falls back to its
            // default-model path (byte-identical to pre-alpha.37 for the
            // null case).
            ...(selection.model !== null ? { model: selection.model } : {}),
          });
          opts.registry.set(chatSessionId, session, binding);
        }

        await emit({
          type: 'chat.start',
          ts: ts(),
          chat_session_id: chatSessionId,
          prompt,
        });

        // Subscribe BEFORE prompt() so MESSAGE_DELTA / TOOL_CALL events
        // that fire DURING the prompt are captured. The listener is
        // synchronous (Pi's contract); we fire-and-forget the async emit
        // because SSE writes are queued by Hono's stream buffer.
        let lastError: string | undefined;
        unsubscribe = session.subscribe((evt: SwtEvent) => {
          if (evt.type === 'MESSAGE_DELTA') {
            void emit({
              type: 'chat.message_delta',
              ts: ts(),
              chat_session_id: chatSessionId,
              text: evt.text,
            });
          } else if (evt.type === 'TOOL_CALL') {
            void emit({
              type: 'chat.tool_call',
              ts: ts(),
              chat_session_id: chatSessionId,
              tool: evt.name,
            });
          } else if (evt.type === 'TASK_TOKEN_USAGE') {
            void emit({
              type: 'chat.token_usage',
              ts: ts(),
              chat_session_id: chatSessionId,
              input: evt.usage.input,
              output: evt.usage.output,
              cacheRead: evt.usage.cacheRead,
              cacheWrite: evt.usage.cacheWrite,
              provider: evt.usage.provider,
              model: evt.usage.model,
            });
          } else if (evt.type === 'TASK_ERROR') {
            // Capture for post-prompt handling — don't emit chat.error
            // mid-stream because the spec orders chat.error AFTER any
            // streamed delta/tool_call events and BEFORE chat.complete.
            lastError = evt.errorMessage;
          }
          // AGENT_START / AGENT_END / TOOL_RESULT — intentionally filtered.
        });

        try {
          // alpha.35 fix: pass streamingBehavior='followUp' so back-to-back
          // user messages queue instead of throwing "Agent is already
          // processing." Pi 0.74 requires this whenever a prior prompt is
          // still streaming on the same session — without it, the second
          // chat turn surfaces as CHAT_PROMPT_ERROR even though the user's
          // intent ("send another message") was clear. `'followUp'` matches
          // chat UX (queue, don't interrupt); `'steer'` would be wrong here
          // since the user typed a follow-up question, not a course-correct.
          await session.prompt(prompt, { streamingBehavior: 'followUp' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await emit({
            type: 'chat.error',
            ts: ts(),
            chat_session_id: chatSessionId,
            code: 'CHAT_PROMPT_ERROR',
            message,
          });
          await emit({ type: 'chat.complete', ts: ts(), chat_session_id: chatSessionId });
          return;
        }

        if (lastError !== undefined) {
          await emit({
            type: 'chat.error',
            ts: ts(),
            chat_session_id: chatSessionId,
            code: 'CHAT_SESSION_ERROR',
            message: lastError,
          });
        } else {
          await emit({
            type: 'chat.message_end',
            ts: ts(),
            chat_session_id: chatSessionId,
          });
        }
        await emit({ type: 'chat.complete', ts: ts(), chat_session_id: chatSessionId });
      } finally {
        // Unsubscribe is per-turn — the SwtSession itself stays
        // registered for the next POST. The registry owns disposal via
        // TTL sweep + close().
        if (unsubscribe !== undefined) {
          try {
            unsubscribe();
          } catch {
            // Swallow — unsubscribe errors must not crash the route.
          }
        }
      }
    });
  });

  return app;
}
