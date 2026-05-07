import { describe, expect, it, beforeEach } from 'vitest';

import { TelemetryClient } from '../src/client.js';
import { TestSender } from '../src/sender.js';

const TEST_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

let setTimeoutMock: typeof setTimeout;
let clearTimeoutMock: typeof clearTimeout;
let pendingTimers: Array<{ id: number; cb: () => void }>;
let nextTimerId: number;

beforeEach(() => {
  pendingTimers = [];
  nextTimerId = 1;
  setTimeoutMock = ((cb: () => void) => {
    const id = nextTimerId++;
    pendingTimers.push({ id, cb });
    return { id, unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  clearTimeoutMock = ((handle: { id: number }) => {
    pendingTimers = pendingTimers.filter((t) => t.id !== handle.id);
  }) as unknown as typeof clearTimeout;
});

function makeClient(
  opts: { enabled?: boolean; anonymousId?: string | null; sender?: TestSender } = {},
) {
  const sender = opts.sender ?? new TestSender();
  const client = new TelemetryClient({
    sender,
    enabled: opts.enabled ?? true,
    anonymousId: opts.anonymousId === undefined ? TEST_ID : opts.anonymousId,
    now: () => 1_700_000_000_000,
    setTimeoutImpl: setTimeoutMock,
    clearTimeoutImpl: clearTimeoutMock,
  });
  return { client, sender };
}

describe('TelemetryClient', () => {
  it('records events when enabled with a valid anonymous id', async () => {
    const { client, sender } = makeClient();
    client.send('cli.command_invoked', { command_name: 'vibe' });
    await client.flush();
    expect(sender.received).toHaveLength(1);
    expect(sender.received[0].name).toBe('cli.command_invoked');
    expect(sender.received[0].properties).toEqual({ command_name: 'vibe' });
    expect(sender.received[0].anonymous_id).toBe(TEST_ID);
  });

  it('drops events when disabled', async () => {
    const { client, sender } = makeClient({ enabled: false });
    client.send('cli.command_invoked', { command_name: 'vibe' });
    await client.flush();
    expect(sender.received).toEqual([]);
  });

  it('drops events when anonymousId is null', async () => {
    const { client, sender } = makeClient({ anonymousId: null });
    client.send('cli.command_invoked', { command_name: 'vibe' });
    await client.flush();
    expect(sender.received).toEqual([]);
  });

  it('flush is no-op on empty buffer', async () => {
    const { client, sender } = makeClient();
    await client.flush();
    expect(sender.received).toEqual([]);
  });

  it('disable empties the buffer and clears the timer', () => {
    const { client, sender } = makeClient();
    client.send('cli.command_invoked', { command_name: 'vibe' });
    expect(pendingTimers).toHaveLength(1);
    client.disable();
    expect(pendingTimers).toHaveLength(0);
    void client.flush().then(() => {
      expect(sender.received).toEqual([]);
    });
  });

  it('schedules exactly one flush per batch', () => {
    const { client } = makeClient();
    client.send('cli.command_invoked', { command_name: 'vibe' });
    client.send('cli.command_invoked', { command_name: 'init' });
    client.send('cli.command_invoked', { command_name: 'detect-phase' });
    expect(pendingTimers).toHaveLength(1);
  });

  it('survives sender failure without throwing', async () => {
    const sender = new TestSender();
    sender.fail = true;
    const { client } = makeClient({ sender });
    client.send('cli.command_invoked', { command_name: 'vibe' });
    await expect(client.flush()).resolves.toBeUndefined();
  });
});
