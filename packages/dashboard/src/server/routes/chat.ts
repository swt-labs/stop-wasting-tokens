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
 * **JSONL dual-emit (alpha.47):** every emitted `chat.*` event is also
 * appended to `<projectRoot>/.swt-planning/.events/chat-<chatSessionId>.jsonl`
 * so the dashboard can rehydrate the Log card's chat history after a
 * daemon restart. The write is best-effort + try/swallowed (mirrors the
 * init / map JSONL pattern — disk write failures must not crash a live
 * SSE stream). The on-disk channel feeds two consumers:
 *   1. `GET /api/chat/history` (client bootstrap) — reads every
 *      `chat-*.jsonl` file and projects each line into a `LogEntry`
 *      shape for `state.unifiedLog` seeding before SSE opens.
 *   2. `createEventsTailer` chokidar watch on `.swt-planning/.events/` —
 *      republishes any line appended after a client connects, which is
 *      what powers the live SSE channel for non-originating tabs.
 *
 * The Pi `AgentSession` itself is NOT recoverable — its
 * `SessionManager.inMemory` is disposed at daemon shutdown
 * (`ChatSessionRegistry.close()`). So restored chat history is
 * display-only: the user sees the prior transcript, and the next
 * `POST /api/chat` starts a fresh Pi session with no native history.
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
 * **Pi 0.74 constraint:** no top-level `systemPrompt` option on
 * `createAgentSession`. SWT uses Pi's documented `resourceLoader.getSystemPrompt()`
 * escape hatch via `SwtSessionOptions.systemPrompt` — see
 * `buildPiResourceLoader` at `runtime/src/session.ts:51-89` + Locked
 * Decision D13. Milestone 24 Phase 03 (Cause C) wires
 * `CHAT_VENDOR_NEUTRAL_SYSTEM_PROMPT` (defined below) through this seam so
 * non-identity-trained chat models no longer echo Pi's hardcoded default
 * `"You are an expert coding assistant operating inside pi…"` identity.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  createSession as defaultCreateSession,
  resolveActiveProvider as defaultResolveActiveProvider,
  resolveSpawnCredential as defaultResolveSpawnCredential,
  type SwtEvent,
  type SwtSession,
} from '@swt-labs/runtime';
import {
  SnapshotEventSchema,
  type ChatCompleteEvent,
  type ChatErrorEvent,
  type ChatMessageDeltaEvent,
  type ChatMessageEndEvent,
  type ChatStartEvent,
  type ChatTokenUsageEvent,
  type ChatToolCallEvent,
  type LogEntry,
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

/**
 * Vendor-neutral chat-mode system prompt — passed to Pi via the
 * `resourceLoader.getSystemPrompt()` escape hatch (Locked Decision D13).
 *
 * Pi 0.74's hardcoded default at `pi-coding-agent/dist/core/system-prompt.js:83`
 * is `"You are an expert coding assistant operating inside pi, a coding
 * agent harness."` — non-identity-trained models (DeepSeek, etc.) echo
 * it verbatim when asked "who are you?", leaking Pi as a brand into the
 * model's identity layer and violating SWT's Principle 1
 * (vendor-agnostic methodology).
 *
 * `runtime/src/session.ts:51-89` (`buildPiResourceLoader`) threads this
 * value into `DefaultResourceLoader({systemPrompt})` → Pi's
 * `_rebuildSystemPrompt` reads it as `customPrompt` → `buildSystemPrompt`
 * REPLACES Pi's default (NOT appends). The same REPLACE seam is already
 * live for non-chat sessions (cook/agent/init) via `SwtSessionOptions.systemPrompt`
 * (declared at `packages/shared/src/types/session.ts:177` with
 * REPLACE-documenting JSDoc citing GATE-07 / GATE-15) — Phase 03 of
 * milestone 24 closes the chat-side gap.
 *
 * Closes Cause C of milestone 24 (a_non_production_files/model_pickup.md).
 */
const CHAT_VENDOR_NEUTRAL_SYSTEM_PROMPT =
  'You are a helpful coding assistant. When asked who you are, identify ' +
  'yourself by your model name (e.g., DeepSeek V3, GPT-4o, Claude Sonnet) ' +
  'rather than by the harness or toolchain you are running inside.';

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

    // alpha.47 — per-chat-session JSONL transcript file. Lazy-mkdir on first
    // append so the route doesn't touch the disk when persistence is disabled
    // (projectRoot pointing at a non-existent path in unit tests). The
    // try/swallow around each append mirrors init.ts:170-177 — disk failure
    // must NEVER crash a live SSE stream; the in-memory bus + SSE write
    // remain authoritative for live subscribers.
    const eventsDir = path.join(opts.projectRoot, '.swt-planning', '.events');
    const eventsFile = path.join(eventsDir, `chat-${chatSessionId}.jsonl`);
    let eventsDirReady = false;

    return streamSSE(c, async (stream) => {
      const ts = (): string => new Date().toISOString();

      /**
       * Emit a chat.* event to the bus (telemetry parity), the SSE stream
       * (the live channel the dashboard subscribes to), AND the on-disk
       * JSONL transcript (alpha.47 — feeds `GET /api/chat/history` for
       * post-restart rehydration). All three sinks are independently
       * try/swallowed so one failure cannot block the others.
       */
      const emit = async (evt: ChatSseEvent): Promise<void> => {
        try {
          opts.bus.publish(evt);
        } catch {
          // Bus listeners that throw are already swallowed by the bus
          // implementation; this catch is defense-in-depth.
        }
        try {
          if (!eventsDirReady) {
            mkdirSync(eventsDir, { recursive: true });
            eventsDirReady = true;
          }
          appendFileSync(eventsFile, JSON.stringify(evt) + '\n');
        } catch {
          // Disk persistence is best-effort — a write failure means the
          // post-restart rehydration path is broken for this session but
          // the live channels above already delivered the event. Common
          // case in unit tests where `projectRoot` is a fake path.
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
            // milestone 24 Phase 03 — close Cause C (Pi-brand identity leak)
            // by passing a vendor-neutral systemPrompt through Pi's
            // documented `resourceLoader.getSystemPrompt()` escape hatch
            // (Locked Decision D13). See `CHAT_VENDOR_NEUTRAL_SYSTEM_PROMPT`
            // docblock above for the REPLACE-vs-APPEND seam trace.
            systemPrompt: CHAT_VENDOR_NEUTRAL_SYSTEM_PROMPT,
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
          // milestone 24 Phase 02 T02 (Locked Decision D12) — surface the
          // model Pi actually resolved at chat-session construction time
          // (alpha.37 wiring resolves `selection.model` from config.model
          // via `resolveActiveProvider` at L268). `null` when no model is
          // pinned; the reducer guard short-circuits on null/empty.
          model: selection.model,
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

  // alpha.47 — `GET /api/chat/history`. Reads every `chat-*.jsonl` file
  // under `<projectRoot>/.swt-planning/.events/`, projects each line into
  // a `LogEntry`, and returns the sorted list so the client can seed
  // `state.unifiedLog` on dashboard boot. The projection is deliberately
  // lossy: streaming-only frames (`chat.message_end`, `chat.complete`)
  // are dropped, and per-assistant-turn deltas are folded into a single
  // `chat-assistant` entry (mirroring the in-memory reducer at
  // `dashboard-store.ts:1418-1480`). Read failures fall back to an empty
  // list — the client never gets a 500 from rehydration.
  app.get('/history', (c) => {
    const entries: LogEntry[] = [];
    try {
      const dirEntries = readdirSync(path.join(opts.projectRoot, '.swt-planning', '.events'), {
        withFileTypes: true,
      });
      for (const dirent of dirEntries) {
        if (!dirent.isFile()) continue;
        if (!dirent.name.startsWith('chat-') || !dirent.name.endsWith('.jsonl')) continue;
        const filePath = path.join(opts.projectRoot, '.swt-planning', '.events', dirent.name);
        let text: string;
        try {
          text = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        projectChatJsonlIntoEntries(text, entries);
      }
    } catch {
      // Events dir absent (greenfield daemon, never wrote a chat) —
      // return an empty list. The client treats `entries: []` as
      // "nothing to rehydrate" and the unifiedLog stays empty.
    }
    // Chronological order: file iteration order is filesystem-dependent;
    // sort by ts so multi-session histories interleave correctly.
    entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return c.json({ entries });
  });

  return app;
}

/**
 * alpha.47 — fold a single chat-*.jsonl file's parsed lines into LogEntry
 * shapes appended to `out`. Mirrors the in-memory reducer's projection in
 * `dashboard-store.ts handleChatEvent` so a restored transcript is
 * byte-identical (modulo entry ids — those are re-generated server-side
 * from the file basename + a per-line counter to stay stable across
 * reloads) to what the user saw before the daemon restart.
 *
 * Per-turn assistant accumulation: `chat.message_delta` text is appended
 * to the most-recent in-progress `chat-assistant` entry for the same
 * chat_session_id; `chat.tool_call` extends `tools_called[]`;
 * `chat.token_usage` stamps the `usage` field; `chat.message_end` /
 * `chat.complete` mark `completed: true`. A new `chat.start` always
 * pushes a fresh `chat-user` LogEntry and resets the in-progress
 * assistant slot for that session id.
 */
function projectChatJsonlIntoEntries(jsonl: string, out: LogEntry[]): void {
  let entryCounter = 0;
  const inProgress = new Map<string, number>(); // chat_session_id → index in `out`
  for (const line of jsonl.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = SnapshotEventSchema.safeParse(parsed);
    if (!result.success) continue;
    const evt = result.data;
    if (!evt.type.startsWith('chat.')) continue;
    if (evt.type === 'chat.start') {
      out.push({
        kind: 'chat-user',
        id: `chat-history-${++entryCounter}`,
        ts: evt.ts,
        chat_session_id: evt.chat_session_id,
        text: evt.prompt,
      });
      inProgress.delete(evt.chat_session_id);
      continue;
    }
    if (
      evt.type === 'chat.message_delta' ||
      evt.type === 'chat.tool_call' ||
      evt.type === 'chat.token_usage' ||
      evt.type === 'chat.message_end' ||
      evt.type === 'chat.complete'
    ) {
      let idx = inProgress.get(evt.chat_session_id);
      if (idx === undefined) {
        // No in-progress assistant entry — synthesize one (matches the
        // dashboard-store.ts synthesis fallback for out-of-order arrivals).
        out.push({
          kind: 'chat-assistant',
          id: `chat-history-${++entryCounter}`,
          ts: evt.ts,
          chat_session_id: evt.chat_session_id,
          text: '',
          completed: false,
        });
        idx = out.length - 1;
        inProgress.set(evt.chat_session_id, idx);
      }
      const target = out[idx];
      if (target === undefined || target.kind !== 'chat-assistant') continue;
      if (evt.type === 'chat.message_delta') {
        out[idx] = { ...target, text: target.text + evt.text };
      } else if (evt.type === 'chat.tool_call') {
        out[idx] = { ...target, tools_called: [...(target.tools_called ?? []), evt.tool] };
      } else if (evt.type === 'chat.token_usage') {
        out[idx] = {
          ...target,
          usage: {
            input: evt.input,
            output: evt.output,
            cacheRead: evt.cacheRead,
            cacheWrite: evt.cacheWrite,
            provider: evt.provider,
            model: evt.model,
          },
        };
      } else if (evt.type === 'chat.message_end' || evt.type === 'chat.complete') {
        out[idx] = { ...target, completed: true };
        if (evt.type === 'chat.complete') inProgress.delete(evt.chat_session_id);
      }
      continue;
    }
    if (evt.type === 'chat.error') {
      out.push({
        kind: 'chat-error',
        id: `chat-history-${++entryCounter}`,
        ts: evt.ts,
        chat_session_id: evt.chat_session_id,
        code: evt.code,
        message: evt.message,
      });
      inProgress.delete(evt.chat_session_id);
      continue;
    }
  }
}
