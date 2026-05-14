/**
 * Plan 01-05 (Phase 1) — dashboard-side state store for the askUser primitive.
 *
 * Self-contained Solid store that:
 *
 *   1. Opens its own SSE subscription (`/api/events`) on mount.
 *   2. Filters incoming events for `prompt.request` (push) and `prompt.response`
 *      (pop) — keeps a FIFO queue of unresolved prompts in memory.
 *   3. Bootstraps from `GET /api/prompts/pending` on mount so a tab refresh
 *      doesn't lose unresolved prompts.
 *   4. Exposes `respondToPrompt(promptId, response)` which POSTs to
 *      `/api/prompts/:id/respond` and optimistically removes the prompt
 *      from the queue on success.
 *
 * This module intentionally does NOT consume `dashboard-store.ts`'s SSE
 * connection — keeping the prompts store decoupled means it can be mounted
 * in isolation (Storybook, future panel layouts) and doesn't require new
 * keys in the global dashboard state.
 */

import type { PromptRequestEvent, SnapshotEvent } from '@swt-labs/shared';
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

export interface PromptResponseBody {
  /** Picked option label, or null when the user submitted freeform. */
  readonly selectedOption: string | null;
  /** Freeform body, or null when the user picked a structured option. */
  readonly freeform: string | null;
}

export interface PromptsStore {
  /** Current FIFO queue of unresolved prompts. Newest at the tail. */
  readonly prompts: Accessor<PromptRequestEvent[]>;
  /**
   * Submit a response for the given prompt. POSTs to the dashboard server
   * and optimistically removes the prompt from the queue on a 2xx response.
   * Throws on non-2xx — callers should surface the error in the UI.
   */
  respondToPrompt: (promptId: string, response: PromptResponseBody) => Promise<void>;
  /** Tear down the SSE subscription. Idempotent. */
  shutdown: () => void;
}

export interface CreatePromptsStoreOptions {
  /**
   * Test seam — override the global fetch. Defaults to window.fetch.
   */
  readonly fetch?: typeof fetch;
  /**
   * Test seam — override EventSource. Defaults to the global EventSource.
   * Set to `null` to disable SSE entirely (useful for unit tests that just
   * exercise respondToPrompt).
   */
  readonly eventSource?: typeof EventSource | null;
  /**
   * Optional auto-bootstrap toggle. Defaults to true — store mounts an SSE
   * + a GET /api/prompts/pending on creation. Tests that want to drive the
   * state manually set it false.
   */
  readonly autoBootstrap?: boolean;
}

/**
 * Create a prompts store. Returns the reactive accessor + actions. Call
 * `shutdown()` from `onCleanup` to release the SSE connection.
 */
export function createPromptsStore(opts: CreatePromptsStoreOptions = {}): PromptsStore {
  const fetchImpl = opts.fetch ?? fetch;
  const EventSourceCtor =
    opts.eventSource === undefined ? globalThis.EventSource : opts.eventSource;
  const autoBootstrap = opts.autoBootstrap ?? true;
  const [prompts, setPrompts] = createSignal<PromptRequestEvent[]>([]);

  let sse: EventSource | null = null;

  const handleEvent = (evt: SnapshotEvent): void => {
    if (evt.type === 'prompt.request') {
      // Dedup on prompt_id — replay events from /api/prompts/pending overlap
      // with the SSE stream during bootstrap, so the same prompt may arrive
      // twice. Keep the first-seen version.
      setPrompts((current) => {
        if (current.some((p) => p.prompt_id === evt.prompt_id)) return current;
        return [...current, evt];
      });
    } else if (evt.type === 'prompt.response') {
      setPrompts((current) => current.filter((p) => p.prompt_id !== evt.prompt_id));
    }
  };

  const bootstrapPending = async (): Promise<void> => {
    try {
      const res = await fetchImpl('/api/prompts/pending', {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { pending?: PromptRequestEvent[] };
      if (!Array.isArray(body.pending)) return;
      for (const evt of body.pending) handleEvent(evt);
    } catch {
      // Bootstrap is best-effort; SSE will catch up on its own. Errors in
      // the JSON parse / network layer aren't actionable from the user's
      // perspective.
    }
  };

  const openSse = (): void => {
    if (EventSourceCtor === null) return;
    sse = new EventSourceCtor('/api/events');
    // The SSE route uses named events for each SnapshotEvent.type — we
    // register listeners for the two we care about. Both handlers parse the
    // data payload as JSON.
    const onPromptRequest = (msg: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(msg.data) as PromptRequestEvent;
        handleEvent(parsed);
      } catch {
        /* malformed payload — server bug; ignore */
      }
    };
    const onPromptResponse = (msg: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(msg.data) as SnapshotEvent;
        handleEvent(parsed);
      } catch {
        /* malformed payload — server bug; ignore */
      }
    };
    sse.addEventListener('prompt.request', onPromptRequest as EventListener);
    sse.addEventListener('prompt.response', onPromptResponse as EventListener);
  };

  const respondToPrompt = async (promptId: string, response: PromptResponseBody): Promise<void> => {
    const body = {
      prompt_id: promptId,
      selectedOption: response.selectedOption,
      freeform: response.freeform,
    };
    const res = await fetchImpl(`/api/prompts/${encodeURIComponent(promptId)}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`prompt response failed (${res.status}): ${text}`);
    }
    // Optimistic removal — the SSE prompt.response event will arrive shortly
    // after and idempotently drop the same prompt_id from the queue.
    setPrompts((current) => current.filter((p) => p.prompt_id !== promptId));
  };

  const shutdown = (): void => {
    if (sse) {
      sse.close();
      sse = null;
    }
  };

  if (autoBootstrap) {
    onMount(() => {
      void bootstrapPending();
      openSse();
    });
    onCleanup(shutdown);
  }

  return { prompts, respondToPrompt, shutdown };
}
