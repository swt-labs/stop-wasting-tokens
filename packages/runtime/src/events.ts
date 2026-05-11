import { extractUsage } from './providers/extractors/index.js';
import type { SwtEvent } from './types.js';

/**
 * Normalise Pi's raw AgentSessionEvent stream into vendor-neutral SwtEvents.
 *
 * PR-07 wires `turn_end` → `TASK_TOKEN_USAGE` (per-provider field extraction
 * lives in `packages/runtime/src/providers/extractors/<provider>.ts`). PR-02
 * shipped the structural foundation; subsequent PRs will add `turn_start`
 * + `queue_update` mappings as the orchestration layer grows.
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
// narrow once the cassette infra (PR-06) gives us realistic event payloads
// to assert against. For now the mapper inspects `type` + a handful of
// common fields, so an `unknown` upgrade path is fine.
interface PiEventLike {
  readonly type: string;
  readonly sessionId?: string;
  readonly delta?: { readonly text?: string };
  readonly toolCall?: { readonly name: string };
  readonly toolResult?: { readonly name: string };
  readonly turn?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly usage?: unknown;
  readonly message?: { readonly usage?: unknown };
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
    case 'turn_end': {
      // Pi carries token usage on `event.message.usage` (AgentMessage.usage,
      // per Pi's docs). Some adapter shapes also surface it at the event
      // root as `event.usage`. Inspect both.
      const usage = e.message?.usage ?? e.usage;
      const provider = e.provider ?? 'unknown';
      const model = e.model ?? 'unknown';
      const turn = typeof e.turn === 'number' ? e.turn : 0;
      const extracted = extractUsage(provider, usage, { turn, provider, model });
      if (extracted === undefined) return undefined;
      return { type: 'TASK_TOKEN_USAGE', sessionId, usage: extracted };
    }
    default:
      // turn_start, queue_*, compaction_*, auto_retry_* not surfaced yet.
      return undefined;
  }
}
