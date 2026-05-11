/**
 * Public surface for `@swt-labs/runtime` — Layer 1 of the v3 architecture.
 *
 * What's exported in PR-02 (Plan 01-01):
 *   - `createSession` + types (`SwtSession`, `SwtSessionOptions`, `SwtEvent`)
 *   - `createCodingTools` / `createReadOnlyTools` (cwd-scoped Pi tool factories)
 *   - `MockSpawnerEnvironment` (consumed by `cli/main.ts`)
 *
 * What lands later in this plan series:
 *   - PR-04: shared types migrate to `@swt-labs/shared`; runtime re-exports from there.
 * What lands in Plan 01-02:
 *   - PR-07: `createTokenMeter` + cost aggregator + `calculateCost`
 *   - PR-08: `resolveModelForRole`, `resolveTierForRole`, `resolveThinkingLevelForRole`,
 *     provider-overrides Extension factory
 *   - PR-09: `swt_report_result` Extension custom tool
 *
 * Per Principle 2 (TDD2 §4.3): orchestration / methodology / cli depend on
 * `@swt-labs/runtime`, not on `@earendil-works/*`. Any new symbol that wraps a
 * Pi primitive belongs here.
 */

export { createSession } from './session.js';
export { createCodingTools, createReadOnlyTools } from './tools.js';
export { mapPiEvent } from './events.js';
export { probePiAvailable, type ProbePiResult } from './probe.js';
export type { SwtSession, SwtSessionOptions, SwtEvent } from './types.js';
export type { TokenMeter, MeterRecord, MeterSnapshot, MeterUpdate } from './meter-types.js';
export { MockSpawnerEnvironment } from './mock/MockSpawnerEnvironment.js';
