/**
 * Public surface for `@swt-labs/runtime` — Layer 1.
 *
 * In PR-04, types (SwtSession, SwtSessionOptions, SwtEvent, TokenMeter, …)
 * live in `@swt-labs/shared`. Runtime re-exports them so existing
 * `from '@swt-labs/runtime'` import sites for those types keep resolving.
 */

export { createSession, createMockSession, routeUsageToMeter } from './session.js';
export { createCodingTools, createReadOnlyTools } from './tools.js';
export { mapPiEvent } from './events.js';
export { probePiAvailable, type ProbePiResult } from './probe.js';
export { MockSpawnerEnvironment } from './mock/MockSpawnerEnvironment.js';
export type {
  SwtSession,
  SwtSessionOptions,
  SwtEvent,
  TaskTokenUsage,
  MeterContext,
  TokenMeter,
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
} from '@swt-labs/shared';

// PR-07: meter primitives (in-memory token meter + cost aggregator + dimensional grouping).
// Per TDD2 §8.1 (TokenMeter contract) and §7.6 (cost calculation).
export {
  createTokenMeter,
  groupRecordsByDimension,
  calculateCost,
  computeCacheHitRatio,
  computeCostByProvider,
  ratioFromCounts,
  type CreateTokenMeterOptions,
  type UsageCounts,
  type ModelCost,
  type CacheHitSummary,
  type CostByProvider,
} from './meter/index.js';
export {
  extractUsage,
  extractAnthropic,
  extractOpenAI,
  extractGeneric,
  type ExtractContext,
} from './providers/extractors/index.js';

// PR-08: provider-layer surface — tier vocabulary, role resolver, quirks-extension factory.
// Per TDD2 §7.1.1 (role→tier→model chain) and §7.5 (provider quirks JSON shape).
export {
  resolveModelForRole,
  resolveTierForRole,
  resolveThinkingLevelForRole,
  getDefaultTierMap,
  DEFAULT_ROLE_TIERS,
  DEFAULT_ROLE_THINKING_LEVELS,
  TIERS,
  SDLC_ROLES,
  isTier,
  isSDLCRole,
  type Tier,
  type SDLCRole,
  type ThinkingLevel,
  type RoleTierMap,
  type DefaultTierMap,
  type ProviderQuirk,
  type ProviderQuirks,
  type ResolveModelOverrides,
} from './providers/index.js';
export {
  default as providerOverridesExtension,
  buildAllProviderConfigs,
} from './extensions/provider-overrides.js';

// PR-32 (M4): Anthropic cache_control breakpoint insertion. Consumes the
// orchestration layer's `BuiltPrompt`-shape (blocks + cacheBreakpointIndex)
// and produces a Pi-bound message array with `cache_control: {type:
// 'ephemeral'}` attached. ADR-006.
export {
  applyCacheControl,
  estimatePromptTokens,
  ANTHROPIC_CACHE_MIN_TOKENS,
  APPROX_CHARS_PER_TOKEN,
  type AnthropicMessage,
  type CacheControlInput,
  type CacheControlResult,
  type CacheSkipReason,
  type PromptBlockLike,
} from './providers/cache-control.js';

// PR-40 (M5): Gemini ToS warning emitter. Operators selecting a
// Gemini-family model get a structured warning about Google's
// training-default-on policy before the first dispatch.
export {
  getGeminiTosWarning,
  getProviderWarning,
  type GeminiTosWarning,
} from './providers/gemini-warnings.js';

// PR-35 (M4): Budget Gate. Per TDD2 §8.4 + ADR-007. Subscribes to a
// TokenMeter; fires budget.warning at 70%, budget.pause at 95%,
// budget.resume after bumpCeiling drops pressure below the warning
// threshold. Pure event-driven; no IO.
export {
  createBudgetGate,
  type BudgetEvent,
  type BudgetGate,
  type BudgetGateOptions,
  type BudgetGateState,
  type BudgetStatus,
} from './budget/gate.js';

// PR-09: result-protocol + journal extensions (ADR-002 Accepted).
// The closure-captured `pi.appendEntry` pattern is encoded in `PiExtensionAPI`
// (see `extensions/pi-types.ts`) — `PiExtensionContext` intentionally has NO
// `appendEntry` field, so `ctx.appendEntry(...)` is a TS error.
export {
  buildResultProtocolExtension,
  resultProtocolExtension,
  SwtReportResultParamsSchema,
  enrichWithFileMetadata,
  getTaskIdFromCtx,
  buildJournalExtension,
  journalExtension,
  FileJournalSink,
  MemoryJournalSink,
  type SwtReportResultParams,
  type ResultProtocolExtensionOptions,
  type JournalExtensionOptions,
  type PiExtensionAPI,
  type PiExtensionContext,
  type PiSessionEntry,
  type PiToolDefinition,
  type PiToolExecuteResult,
  type JournalSink,
} from './extensions/index.js';

// PR-20 (M2): Pi RPC-mode delegator per TDD2 §3.2 + §5. Surfaces Pi's
// JSON-RPC protocol mode under the `swt rpc` binary name. Pi import +
// delegation shape locked here; real `AgentSessionRuntime` construction
// activates at M3 PR-22.
export { runRpc, RpcModeUnavailableError, type RunRpcOptions } from './rpc-runner.js';

// Plan 01-02 (Phase 1): Pi-substrate primitives 5 + 6 — `swt:installRoot()`
// and `swt:sessionId()`. Populate SWT_INSTALL_ROOT / SWT_SESSION_ID on
// `process.env` at CLI bootstrap so every spawned bash script and Pi
// session inherits the canonical pair (TDD3 §14, REQ-01).
export { resolveInstallRoot, resolveSessionId, applyEnvToProcess } from './env.js';

// Plan 01-03 (Phase 1): Pi-substrate primitive 3 — `swt:fireHook`. In-process
// event dispatcher that subscribes to Pi session events and spawns bash
// handler scripts with the env contract required by scripts/bash-guard.sh
// and scripts/file-guard.sh (TDD3 §8.2, REQ-01, REQ-06). PreToolUse is
// advisory in Phase 1 because Pi 0.74 does not expose a pre-execution
// intercept on createAgentSession — see dispatcher.ts for the TODO(Phase F).
export {
  createHookDispatcher,
  loadHookRegistrationsFromConfig,
  type HookDispatcher,
  type HookDispatcherOptions,
  type HookEventBus,
  type HookEventBusEntry,
  type HookEvent,
  type HookMatcher,
  type HookRegistration,
  type HookContext,
  type HookDecision,
} from './hooks/index.js';

// Plan 01-04 (Phase 1): Pi-substrate primitive 4 — `swt:invokeSkill`. Raw
// SKILL.md file reader with two-tier path resolution (user-installed wins
// over bundled). The Pi custom-tool registration that bridges this reader
// onto agent sessions lives in spawnAgent (plan 01-01), not here. TDD3
// §14, REQ-06.
export {
  invokeSkill,
  resolveSkillPath,
  type InvokeSkillOptions,
} from './skills/index.js';

// Plan 01-05 (Phase 1): Pi-substrate primitive 2 — `swt:askUser`. Dashboard-
// mediated structured prompt with readline headless fallback (research §2
// primitive 2). ORCHESTRATOR-ONLY invariant — the swt_ask_user Pi custom
// tool is registered on the orchestrator session only; spawned roles
// (dev/qa/scout/lead/architect/debugger/docs) never receive it. The
// invariant is enforced at spawn-agent.ts (plan 01-01) and mechanically
// asserted in packages/runtime/test/ask-user/ask-user.test.ts (A.6).
// TDD3 §14, REQ-01, REQ-06.
export {
  askUser,
  type AskUserOption,
  type AskUserOptions,
  type AskUserQuestion,
  type AskUserResponse,
} from './ask-user/index.js';

// Plan 03-02 (Phase 3, R2): `swt_ask_user` Pi custom-tool bridge. Wires the
// orchestrator's confirmation gates + UAT checkpoint prompts onto a Pi
// session via a single registerTool() call. The bridge delegates to
// `askUser()` — it does not reimplement the dashboard SSE / readline /
// auto-accept fallbacks. The orchestrator-only invariant (only the
// orchestrator session registers this tool) is enforced in
// `@swt-labs/orchestration`'s `spawnOrchestratorSession` and mechanically
// asserted in `packages/runtime/test/ask-user/ask-user.test.ts` (A.6).
export {
  buildSwtAskUserExtension,
  SWT_ASK_USER_TOOL_NAME,
  type BuildSwtAskUserExtensionOptions,
  type SwtAskUserToolParams,
  type SwtAskUserToolResult,
} from './ask-user/swt-ask-user-tool.js';
