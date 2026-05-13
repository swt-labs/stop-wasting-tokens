/**
 * Plan 01-05 (Phase 1) — SnapshotEvent variants for the `swt:askUser` IPC
 * contract.
 *
 * The canonical `SnapshotEvent` discriminated union lives in
 * `../schemas/events.ts` (Zod-first; `SnapshotEvent = z.infer<typeof
 * SnapshotEventSchema>`). This module re-exports the two `prompt.*` variants
 * added at plan 01-05 alongside their option/option-shape types so consumers
 * can import them by name without reaching into the schemas folder.
 *
 * The exported names match research §5's IPC contract verbatim:
 *
 *   {
 *     type: 'prompt.request',
 *     ts, session_id, prompt_id,
 *     header?, question, options[], multiSelect?, preview?
 *   }
 *
 *   {
 *     type: 'prompt.response',
 *     ts, session_id, prompt_id,
 *     selectedOption, freeform
 *   }
 *
 * Phase D swaps the SSE+REST transport for a Unix domain socket (research §5
 * option A); the message shape stays identical so the API surface above is
 * forward-compatible.
 *
 * The orchestrator-only askUser invariant — `swt_ask_user` is registered as a
 * Pi custom tool ONLY on the orchestrator session, NEVER on dev/qa/scout/lead/
 * architect/debugger/docs — is enforced at the spawn-agent.ts tool-list
 * construction layer (plan 01-01) and mechanically asserted by the cross-plan
 * regression test in `packages/runtime/test/ask-user/ask-user.test.ts`
 * (plan 01-05 task 5, assertion A.6). This types module is intentionally
 * neutral about tool registration — it owns the IPC payload shape only.
 */

export type {
  PromptRequestEvent,
  PromptResponseEvent,
  PromptRequestOption,
} from '../schemas/events.js';

export {
  PromptRequestEventSchema,
  PromptResponseEventSchema,
  PromptRequestOptionSchema,
} from '../schemas/events.js';
