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
  // alpha.21 — `turn_end.message` carries `{stopReason, errorMessage, ...}`
  // when the upstream API call fails (Pi keeps the HTTP body in
  // `errorMessage`; `stopReason='error'` is the discriminator). Pi does NOT
  // throw from `agentSession.prompt()` in this case — the failure is
  // entirely event-channeled, so the mapper has to surface it explicitly.
  readonly message?: {
    readonly usage?: unknown;
    readonly stopReason?: string;
    readonly errorMessage?: string;
    readonly provider?: string;
    readonly model?: string;
  };
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
      // alpha.21 — Pi keeps upstream API failures on the message envelope
      // rather than throwing from `agentSession.prompt()`: `stopReason
      // === 'error'` + `errorMessage` populated. Surface this as a
      // first-class `TASK_ERROR` SwtEvent so the dispatcher can translate
      // the silent no-op into `TaskResult.status='failed'`. Otherwise the
      // failure is entirely lost — the cook orchestrator reports
      // `cook.agent_result status="completed"` with zero tokens, the
      // dashboard renders nothing, and the user has no signal that the
      // LLM never actually ran. Out-of-credits, invalid-request, rate-
      // limit, network — every upstream failure now lights up here.
      //
      // Note: when `stopReason === 'error'` Pi falls back to
      // `withUsageEstimate`, which produces a {input,output,cacheRead,
      // cacheWrite,totalTokens,cost} usage shape that intentionally does
      // NOT match either provider extractor's snake_case contract — those
      // estimates are not metered, since the LLM call never billed. We
      // skip token extraction on error turns to avoid corrupting cost
      // accounting with synthetic numbers; TASK_ERROR wins.
      if (e.message?.stopReason === 'error') {
        const errorMessage =
          typeof e.message.errorMessage === 'string' && e.message.errorMessage.length > 0
            ? e.message.errorMessage
            : 'Pi turn_end emitted stopReason=error with no errorMessage body';
        return { type: 'TASK_ERROR', sessionId, errorMessage };
      }
      // Happy-path: token usage extraction (PR-07 path). Pi carries token
      // usage on `event.message.usage` (AgentMessage.usage, per Pi's
      // docs). Some adapter shapes also surface it at the event root as
      // `event.usage`. Inspect both.
      const usage = e.message?.usage ?? e.usage;
      // Prefer the provider/model from the message envelope (alpha.21 —
      // Pi populates these on the assistant message, NOT on the event
      // root, so the pre-alpha.21 path defaulted to 'unknown' and made
      // the extractors unable to dispatch on provider). Fall back to the
      // event root for adapter shapes that still emit there.
      const provider = e.message?.provider ?? e.provider ?? 'unknown';
      const model = e.message?.model ?? e.model ?? 'unknown';
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
