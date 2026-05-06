import type { TelemetryEvent } from './events.js';

export interface Sender {
  send(events: readonly TelemetryEvent[]): Promise<void>;
}

export class NoopSender implements Sender {
  async send(_events: readonly TelemetryEvent[]): Promise<void> {
    /* drop on the floor — real HTTP sender lands in v1.5 */
  }
}

export class TestSender implements Sender {
  readonly received: TelemetryEvent[] = [];
  fail = false;

  async send(events: readonly TelemetryEvent[]): Promise<void> {
    if (this.fail) throw new Error('TestSender configured to fail');
    this.received.push(...events);
  }
}
