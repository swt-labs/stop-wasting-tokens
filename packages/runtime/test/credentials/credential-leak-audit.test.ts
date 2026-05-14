import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SwtSessionOptions } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mapPiEvent } from '../../src/events.js';
import {
  buildJournalExtension,
  FileJournalSink,
  MemoryJournalSink,
} from '../../src/extensions/journal.js';
import type { PiExtensionAPI, PiExtensionContext } from '../../src/extensions/pi-types.js';

/**
 * Plan 03-01 (Phase 3) T4 — the §6 credential-leak audit's PERMANENT
 * regression guard.
 *
 * Research §6 ("Never-log / never-persist rules") requires that a resolved
 * credential — `SwtSessionOptions.resolvedCredential.secret`, an API-key
 * string — NEVER reaches a `.swt-planning/.transcripts/*.jsonl` or
 * `.swt-planning/.events/*.jsonl` channel.
 *
 * AUDIT FINDING (recorded in full in 03-01-SUMMARY.md): **NO LEAK FOUND.**
 * The journal/transcript JSONL path is `buildJournalExtension` →
 * `mapPiEvent` → `JournalSink.write`. `mapPiEvent` (events.ts) is a
 * fixed-field projection of raw Pi events — it reads only `type`,
 * `sessionId`, `delta.text`, `toolCall.name`, `toolResult.name`, `turn`,
 * `provider`, `model`, `usage` — and emits a closed `SwtEvent` union with
 * NO credential field. `SwtSessionOptions.resolvedCredential` is consumed
 * ONLY by `session.ts:createSession`'s in-memory `AuthStorage.set()` and
 * is `void`-ed everywhere else; it is never handed to a serializer.
 *
 * This test stands as the executable, permanent proof of that invariant.
 * It exercises the REAL emission code path (the journal extension + the
 * real `mapPiEvent`, the real `FileJournalSink`) — not a hand-rolled stub.
 */

const SENTINEL = 'SENTINEL-LEAK-CANARY-9f3a';

/** A `SwtSessionOptions` carrying the sentinel as its resolved credential. */
const SESSION_OPTS_WITH_SECRET: SwtSessionOptions = {
  cwd: '/tmp/swt-credential-leak-audit',
  provider: 'openai',
  resolvedCredential: { authMode: 'api_key', secret: SENTINEL },
};

interface MockPi extends PiExtensionAPI {
  handlers: Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>();
  return {
    handlers,
    registerTool() {
      /* journal extension registers no tools */
    },
    on(event, handler) {
      let bucket = handlers.get(event);
      if (!bucket) {
        bucket = [];
        handlers.set(event, bucket);
      }
      bucket.push(handler);
    },
    appendEntry() {
      /* journal extension appends no entries */
    },
  };
}

const CTX: PiExtensionContext = {
  cwd: '/tmp/swt-credential-leak-audit',
  sessionManager: { getEntries: () => [] },
};

describe('@swt-labs/runtime — credential-leak audit (Plan 03-01, research §6)', () => {
  describe('the journal/transcript serialization path drops the credential', () => {
    it('mapPiEvent never carries a credential-shaped field embedded in a raw Pi event', () => {
      // Adversarial input: a raw Pi-event-like object with the sentinel
      // smuggled onto extra (non-whitelisted) fields — exactly the shape a
      // future regression would take if a credential ever rode along on a
      // session-options object that got attached to an event payload.
      const rawEvents: unknown[] = [
        { type: 'agent_start', sessionId: 's1', resolvedCredential: { secret: SENTINEL } },
        {
          type: 'tool_execution_start',
          sessionId: 's1',
          toolCall: { name: 'grep' },
          apiKey: SENTINEL,
        },
        {
          type: 'message_update',
          sessionId: 's1',
          delta: { text: 'ok' },
          authStorage: { key: SENTINEL },
        },
        { type: 'turn_end', sessionId: 's1', turn: 1, secret: SENTINEL },
      ];

      const mapped = rawEvents.map((e) => mapPiEvent(e, 's1'));
      // The real mapper produced events (the whitelisted fields parsed).
      expect(mapped.some((m) => m !== undefined)).toBe(true);
      // …but the projection dropped every smuggled credential field.
      expect(JSON.stringify(mapped)).not.toContain(SENTINEL);
    });

    it('the journal extension writes ZERO sink lines containing the sentinel', () => {
      const sink = new MemoryJournalSink();
      const pi = createMockPi();
      // Real extension wiring — buildJournalExtension registers the real
      // handlers that run raw events through the real mapPiEvent → sink.
      buildJournalExtension({ sink })(pi);

      // Fire raw events down the real handler chain, each smuggling the
      // sentinel on a field the journal must not propagate.
      pi.handlers
        .get('agent_start')
        ?.[0]?.({ type: 'agent_start', sessionId: 's1', secret: SENTINEL }, CTX);
      pi.handlers
        .get('tool_execution_start')
        ?.[0]?.(
          {
            type: 'tool_execution_start',
            sessionId: 's1',
            toolCall: { name: 'bash' },
            resolvedCredential: { authMode: 'api_key', secret: SENTINEL },
          },
          CTX,
        );
      pi.handlers
        .get('message_update')
        ?.[0]?.(
          { type: 'message_update', sessionId: 's1', delta: { text: 'hello' }, apiKey: SENTINEL },
          CTX,
        );

      // The mapper produced real events (proves the path actually ran).
      expect(sink.events.length).toBeGreaterThan(0);
      // Not one serialized line carries the sentinel.
      expect(JSON.stringify(sink.events)).not.toContain(SENTINEL);
    });

    it('FileJournalSink writes ZERO on-disk JSONL lines containing the sentinel', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'swt-credleak-'));
      try {
        const path = join(tmp, '.transcripts', 'sess-leak.jsonl');
        const sink = new FileJournalSink(path);
        const pi = createMockPi();
        buildJournalExtension({ sink })(pi);

        pi.handlers
          .get('agent_start')
          ?.[0]?.({ type: 'agent_start', sessionId: 's1', apiKey: SENTINEL }, CTX);
        pi.handlers
          .get('tool_execution_end')
          ?.[0]?.(
            {
              type: 'tool_execution_end',
              sessionId: 's1',
              toolResult: { name: 'grep' },
              resolvedCredential: { authMode: 'api_key', secret: SENTINEL },
            },
            CTX,
          );
        sink.close();

        const onDisk = readFileSync(path, 'utf8');
        // The transcript file has real content (the path actually ran)…
        expect(onDisk).toMatch(/AGENT_START/);
        // …and the sentinel appears nowhere in it.
        expect(onDisk).not.toContain(SENTINEL);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('structural invariant — SwtSessionOptions.resolvedCredential is never serializable via the journal', () => {
    it('a raw Pi event with the full SwtSessionOptions object attached still drops the secret', () => {
      // Round-trip the structural reality: even if a session-options object
      // (carrying the sentinel credential) were attached wholesale to a raw
      // event payload, mapPiEvent's fixed-field projection omits it — the
      // journal's serialized output cannot carry resolvedCredential/secret.
      // `agent_start` is used because it ALWAYS maps to a non-undefined
      // SwtEvent, so the assertions exercise a genuinely-serialized event
      // (proves the path ran AND the credential was stripped, not that the
      // whole event was silently dropped).
      const rawWithSessionOpts = {
        type: 'agent_start',
        sessionId: 's1',
        sessionOptions: SESSION_OPTS_WITH_SECRET,
        resolvedCredential: SESSION_OPTS_WITH_SECRET.resolvedCredential,
      };
      const mapped = mapPiEvent(rawWithSessionOpts, 's1');
      // The mapper produced a real event — not undefined.
      expect(mapped).toBeDefined();
      expect(mapped?.type).toBe('AGENT_START');

      const serialized = JSON.stringify(mapped) ?? '';
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).not.toContain('resolvedCredential');
      expect(serialized).not.toContain('"secret"');
      expect(serialized).not.toContain('apiKey');
    });

    it('the SwtSessionOptions fixture genuinely carries the sentinel (the test is not vacuous)', () => {
      // Guard against a vacuous pass: confirm the fixture really holds the
      // secret, so the not.toContain assertions above are meaningful.
      expect(SESSION_OPTS_WITH_SECRET.resolvedCredential?.secret).toBe(SENTINEL);
      expect(JSON.stringify(SESSION_OPTS_WITH_SECRET)).toContain(SENTINEL);
    });
  });
});
