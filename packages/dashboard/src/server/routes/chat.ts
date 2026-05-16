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
  readProjectAuthConfig as defaultReadProjectAuthConfig,
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
  SnapshotEvent,
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
  /** Test seam — defaults to `@swt-labs/runtime`'s `readProjectAuthConfig`. */
  readAuthConfigFn?: typeof defaultReadProjectAuthConfig;
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
  const readAuthConfig = opts.readAuthConfigFn ?? defaultReadProjectAuthConfig;

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
          opts.bus.publish(evt as SnapshotEvent);
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

      // First, try to reuse a session by id. We only reuse when the client
      // explicitly sent a `chat_session_id` — a fresh randomUUID() can't
      // possibly match an existing entry, so skip the lookup to keep the
      // create-path linear when no id is provided.
      let session: SwtSession | undefined = requestedId !== undefined
        ? opts.registry.get(chatSessionId)
        : undefined;
      let unsubscribe: (() => void) | undefined;

      try {
        if (session === undefined) {
          // ─── First turn for this chat_session_id ─────────────────────
          // Resolve credential. We read the auth-config and pick the FIRST
          // configured provider (matches `init.ts:250` + the cook callsite
          // pattern). When the auth block is empty OR the credential
          // resolver returns undefined, surface chat.error CHAT_AUTH_FAILED
          // immediately rather than falling through to Pi's env-var
          // resolution silently (Scout RESEARCH §Q4 + must_have).
          const authConfig = readAuthConfig(opts.projectRoot);
          const providers = Object.keys(authConfig);
          if (providers.length === 0) {
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
          const provider = providers[0]!;
          const resolved = await resolveCredential(provider, authConfig);
          if (resolved === undefined) {
            await emit({
              type: 'chat.error',
              ts: ts(),
              chat_session_id: chatSessionId,
              code: 'CHAT_AUTH_FAILED',
              message: `Could not resolve credential for provider '${provider}'. Check the OS keychain or environment fallback.`,
            });
            await emit({ type: 'chat.complete', ts: ts(), chat_session_id: chatSessionId });
            return;
          }

          session = await createSession({
            cwd: opts.projectRoot,
            ephemeral: true,
            provider: resolved.provider,
            resolvedCredential: resolved.resolvedCredential,
          });
          opts.registry.set(chatSessionId, session);
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
          await session.prompt(prompt);
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
