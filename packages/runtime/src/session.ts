import { randomUUID } from 'node:crypto';

import { mapPiEvent } from './events.js';
import type { SwtSession, SwtSessionOptions, SwtEvent, TokenMeter } from './types.js';

/**
 * Session factory.
 *
 * PR-02 shipped a mock-shape stub. PR-07 wires the meter bridge:
 * `TASK_TOKEN_USAGE` events flow into the attached `TokenMeter`, with
 * task / phase / milestone / role / tier dimensions carried via
 * `SwtSessionOptions.meterContext` (defaulted to empty strings when the
 * session is constructed outside of a TaskBrief).
 *
 * The real Pi wiring (createAgentSession + subscribe + dispose) lands in
 * PR-09's first end-to-end integration. Until then, prompt() stays a
 * no-op but the meter bridge is fully active — tests can drive synthetic
 * `TASK_TOKEN_USAGE` events through `subscribe`'s injection point and
 * assert against the meter snapshot.
 */
export async function createSession(opts: SwtSessionOptions): Promise<SwtSession> {
  return makeMockSwtSession(opts);
}

function makeMockSwtSession(opts: SwtSessionOptions): SwtSession {
  const sessionId = randomUUID();
  const listeners: Array<(event: SwtEvent) => void> = [];
  const meter = opts.meter;
  void opts.ephemeral;
  void opts.cwd;
  // PR-26 wiring: the runtime records `enableResultProtocol` + `taskId`
  // here so the contract surface is locked. The mock prompt() is a
  // no-op so neither is consumed yet; the real Pi adapter (deferred
  // session-wiring follow-up) reads these and threads them through to
  // `createAgentSession({ extensions: [buildResultProtocolExtension()] })`
  // + a task-context session entry per TDD2 §9.4 + ADR-002.
  void opts.enableResultProtocol;
  void opts.taskId;

  let disposed = false;

  // Meter bridge: subscribe internally so externally-attached subscribers
  // don't have to know about meter routing. This is the same fan-out path
  // that PR-09's real Pi-driven event stream will go through.
  if (meter !== undefined) {
    listeners.push((event) => {
      routeUsageToMeter(event, meter, opts.meterContext);
    });
  }

  return {
    sessionId,
    async prompt(_text: string): Promise<void> {
      if (disposed) {
        throw new Error('SwtSession: prompt() called after dispose()');
      }
      return Promise.resolve();
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    dispose() {
      disposed = true;
      listeners.length = 0;
    },
  };
}

/**
 * Translate a TASK_TOKEN_USAGE event into a MeterRecord row and push it
 * into the attached meter. Cost is left at 0 here — the cost calculation
 * runs in the dashboard / cli surface where the provider rate card is
 * resolved (kept out of the runtime so the runtime stays Pi-only).
 *
 * The function is module-private but exported for unit tests in
 * `runtime/test/meter/`.
 */
export function routeUsageToMeter(
  event: SwtEvent,
  meter: TokenMeter,
  ctx: SwtSessionOptions['meterContext'],
): void {
  if (event.type !== 'TASK_TOKEN_USAGE') return;
  const u = event.usage;
  const now = new Date().toISOString();
  meter.record(
    {
      timestamp: now,
      milestone: ctx?.milestone ?? '',
      phase: ctx?.phase ?? '',
      task_id: ctx?.task_id ?? '',
      role: ctx?.role ?? '',
      tier: ctx?.tier ?? '',
      provider: u.provider,
      model: u.model,
      turn: u.turn,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
    },
    0,
  );
}

/**
 * Internal helper exported for the future PR-09 swap-in: maps a stream of
 * Pi events into SwtEvents and fans them out to subscribers. Not exported
 * from the public surface yet (kept out of `index.ts`).
 */
export function fanOutPiEvents(
  rawEvents: AsyncIterable<unknown>,
  sessionId: string,
  listeners: ReadonlyArray<(event: SwtEvent) => void>,
): Promise<void> {
  return (async (): Promise<void> => {
    for await (const raw of rawEvents) {
      const mapped = mapPiEvent(raw, sessionId);
      if (mapped !== undefined) {
        for (const l of listeners) l(mapped);
      }
    }
  })();
}
