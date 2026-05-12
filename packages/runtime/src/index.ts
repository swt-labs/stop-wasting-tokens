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
  type CreateTokenMeterOptions,
  type UsageCounts,
  type ModelCost,
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
