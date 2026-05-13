/**
 * Plan 01-05 (Phase 1) — public askUser surface.
 *
 * Re-exports `askUser` and its companion types for `@swt-labs/runtime`
 * consumers. The Pi custom-tool registration (`swt_ask_user`) that bridges
 * this function onto the orchestrator session lives in a Phase 3 wiring
 * follow-up — NOT in @swt-labs/runtime. The ORCHESTRATOR-ONLY invariant
 * (spawned roles never register swt_ask_user) is enforced at spawn-agent.ts
 * (plan 01-01) and mechanically tested in
 * packages/runtime/test/ask-user/ask-user.test.ts (assertion A.6).
 */

export {
  askUser,
  type AskUserOption,
  type AskUserOptions,
  type AskUserQuestion,
  type AskUserResponse,
} from './ask-user.js';
