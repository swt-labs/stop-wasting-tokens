import type { TelemetryEvent } from './events.js';

export interface Sender {
  send(events: readonly TelemetryEvent[]): Promise<void>;
}

export class NoopSender implements Sender {
  send(_events: readonly TelemetryEvent[]): Promise<void> {
    /* drop on the floor — real HTTP sender lands in v1.5 */
    return Promise.resolve();
  }
}

export class TestSender implements Sender {
  readonly received: TelemetryEvent[] = [];
  fail = false;

  send(events: readonly TelemetryEvent[]): Promise<void> {
    if (this.fail) return Promise.reject(new Error('TestSender configured to fail'));
    this.received.push(...events);
    return Promise.resolve();
  }
}
