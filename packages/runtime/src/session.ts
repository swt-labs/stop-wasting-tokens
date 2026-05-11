import { randomUUID } from 'node:crypto';

import type { SwtSession, SwtSessionOptions, SwtEvent } from './types.js';
import { mapPiEvent } from './events.js';

/**
 * Session factory.
 *
 * PR-02 ships a mock-shape stub: the returned `SwtSession` exposes the full
 * vendor-neutral surface (prompt, subscribe, dispose, sessionId) but does
 * not actually call Pi. PR-06 (Plan 01-02) swaps the body to invoke
 * `createAgentSession()` from `@earendil-works/pi-coding-agent` and wires
 * subscribe → `mapPiEvent` for the event normalisation pipeline. PR-06 also
 * reintroduces the type-only `import type { AgentSession } from
 * '@earendil-works/pi-coding-agent'` boundary check that this file would carry
 * if it had any reason to reference Pi's types in PR-02 (it doesn't yet — the
 * mock doesn't talk to Pi at all).
 *
 * The meter-injection contract is locked in here: when `opts.meter` is set,
 * future PR-07 will record per-turn usage into it. PR-02 just preserves the
 * reference; it is not exercised yet (no real prompts flow).
 */
export async function createSession(opts: SwtSessionOptions): Promise<SwtSession> {
  return makeMockSwtSession(opts);
}

function makeMockSwtSession(opts: SwtSessionOptions): SwtSession {
  const sessionId = randomUUID();
  const listeners: Array<(event: SwtEvent) => void> = [];
  // Silence "unused" lint until PR-06 wires Pi for real. The references are kept
  // so the meter injection contract is type-checked end-to-end today.
  void opts.meter;
  void opts.ephemeral;
  void opts.cwd;

  let disposed = false;

  return {
    sessionId,
    async prompt(_text: string): Promise<void> {
      if (disposed) {
        throw new Error('SwtSession: prompt() called after dispose()');
      }
      // No-op until PR-06. Emitting AGENT_START/END here would lie about a
      // session that didn't actually run; better to stay silent.
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
 * Internal helper exported for the future PR-06 swap-in: maps a stream of
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
