import type { SnapshotEvent } from '@swt-labs/dashboard-core';

export type EventBusListener = (event: SnapshotEvent) => void;
export type Unsubscribe = () => void;

export interface EventBus {
  subscribe(listener: EventBusListener): Unsubscribe;
  publish(event: SnapshotEvent): void;
  size(): number;
}

export function createEventBus(): EventBus {
  const listeners = new Set<EventBusListener>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err: unknown) {
          // Listeners must not throw; if one does, log and keep going so a buggy
          // subscriber can't kill SSE delivery to its peers.
          // eslint-disable-next-line no-console
          console.error('event-bus listener threw:', err);
        }
      }
    },
    size() {
      return listeners.size;
    },
  };
}
