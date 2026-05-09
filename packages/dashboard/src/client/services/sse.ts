import {
  SNAPSHOT_EVENT_TYPES,
  SnapshotEventSchema,
  type SnapshotEvent,
} from '@swt-labs/dashboard-core';

export interface SseHandlers {
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onEvent?: (evt: SnapshotEvent) => void;
}

export interface SseReconnectOptions {
  /** Backoff schedule. Last value is reused if attempts exceed list length. */
  delaysMs?: readonly number[];
  /** Cap on attempts. Default Infinity. */
  maxAttempts?: number;
  /** Called when a reconnect attempt is scheduled. */
  onReconnectAttempt?: (attempt: number) => void;
  /** Called after a reconnect attempt succeeds (open fired with attempt > 0). */
  onReconnected?: () => Promise<void> | void;
}

export interface SseConnection {
  close: () => void;
}

const DEFAULT_DELAYS: readonly number[] = [1000, 2000, 5000, 10000];

export function openSseConnection(
  url: string,
  handlers: SseHandlers,
  reconnect: SseReconnectOptions = {},
): SseConnection {
  const delays = reconnect.delaysMs ?? DEFAULT_DELAYS;
  const maxAttempts = reconnect.maxAttempts ?? Number.POSITIVE_INFINITY;

  let source: EventSource | null = null;
  let attempt = 0;
  let intentionallyClosed = false;
  let pendingReconnect: ReturnType<typeof setTimeout> | null = null;

  const dispatch = (raw: MessageEvent): void => {
    if (!handlers.onEvent) return;
    try {
      const parsed = SnapshotEventSchema.parse(JSON.parse(raw.data as string));
      handlers.onEvent(parsed);
    } catch {
      // Skip events that don't validate; server is the contract owner.
    }
  };

  const attachHandlers = (es: EventSource): void => {
    es.addEventListener('open', () => {
      const wasReconnect = attempt > 0;
      attempt = 0;
      handlers.onOpen?.();
      if (wasReconnect && reconnect.onReconnected) {
        void reconnect.onReconnected();
      }
    });
    es.addEventListener('error', (e) => {
      handlers.onError?.(e);
      es.close();
      source = null;
      scheduleReconnect();
    });
    // Snapshot SSE events are dispatched as MessageEvents on a typed
    // EventSource; the wrapping signature satisfies addEventListener's
    // EventListener contract while keeping the typed dispatch internally.
    const dispatchListener = function (this: EventTarget, event: Event): void {
      dispatch(event as MessageEvent);
    };
    for (const type of SNAPSHOT_EVENT_TYPES) {
      es.addEventListener(type, dispatchListener);
    }
  };

  const open = (): void => {
    if (intentionallyClosed) return;
    source = new EventSource(url);
    attachHandlers(source);
  };

  const scheduleReconnect = (): void => {
    if (intentionallyClosed) return;
    if (attempt >= maxAttempts) return;
    const delay =
      delays[Math.min(attempt, delays.length - 1)] ?? delays[delays.length - 1] ?? 10000;
    attempt += 1;
    reconnect.onReconnectAttempt?.(attempt);
    pendingReconnect = setTimeout(() => {
      pendingReconnect = null;
      open();
    }, delay);
  };

  open();

  return {
    close: () => {
      intentionallyClosed = true;
      if (pendingReconnect) {
        clearTimeout(pendingReconnect);
        pendingReconnect = null;
      }
      source?.close();
      source = null;
    },
  };
}
