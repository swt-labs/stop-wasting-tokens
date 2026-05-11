import type { SwtEvent } from './types.js';

/**
 * Normalise Pi's raw AgentSessionEvent stream into vendor-neutral SwtEvents.
 *
 * Plan 01-02 PR-07 extends this with `turn_end` → `TASK_TOKEN_USAGE` mapping
 * (provider-specific token extractors live alongside in
 * `packages/runtime/src/providers/extractors/<provider>.ts`). PR-02 ships the
 * structural foundation only: a single mapper function that handles the small
 * set of events used by the first end-to-end test (PR-09).
 *
 * Per Pi docs (TDD2 §5.5) the 14 events are:
 *   message_update, tool_execution_{start,update,end},
 *   message_{start,end}, agent_{start,end}, turn_{start,end},
 *   queue_update, compaction_{start,end}, auto_retry_{start,end}
 *
 * `mapPiEvent` returns `undefined` for events we don't surface upward (e.g.,
 * compaction internals). The caller (session.ts) filters those silently.
 */

// Loose shape — Pi's AgentSessionEvent is a discriminated union we'll
// narrow with `type` once the cassette infra (PR-06) gives us realistic
// event payloads to assert against. For PR-02 the mapper only inspects
// `type` + a handful of common fields, so an `unknown` upgrade path is fine.
interface PiEventLike {
  readonly type: string;
  readonly sessionId?: string;
  readonly delta?: { readonly text?: string };
  readonly toolCall?: { readonly name: string };
  readonly toolResult?: { readonly name: string };
}

export function mapPiEvent(raw: unknown, sessionId: string): SwtEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const e = raw as PiEventLike;
  switch (e.type) {
    case 'agent_start':
      return { type: 'AGENT_START', sessionId };
    case 'agent_end':
      return { type: 'AGENT_END', sessionId };
    case 'message_update':
      if (e.delta?.text !== undefined) {
        return { type: 'MESSAGE_DELTA', sessionId, text: e.delta.text };
      }
      return undefined;
    case 'tool_execution_start':
      if (e.toolCall?.name !== undefined) {
        return { type: 'TOOL_CALL', sessionId, name: e.toolCall.name };
      }
      return undefined;
    case 'tool_execution_end':
      if (e.toolResult?.name !== undefined) {
        return { type: 'TOOL_RESULT', sessionId, name: e.toolResult.name };
      }
      return undefined;
    default:
      // turn_*, queue_*, compaction_*, auto_retry_* not surfaced from PR-02.
      // PR-07 adds turn_end → TASK_TOKEN_USAGE; later PRs may add more.
      return undefined;
  }
}
