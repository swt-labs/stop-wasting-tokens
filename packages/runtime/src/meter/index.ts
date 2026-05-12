/**
 * Public barrel for the runtime meter layer.
 *
 * Consumers import `from '@swt-labs/runtime/meter'` for the meter
 * primitives (createTokenMeter, calculateCost) and types. The canonical
 * `from '@swt-labs/runtime'` barrel also re-exports these for ergonomic
 * one-stop imports.
 */

export {
  createTokenMeter,
  groupRecordsByDimension,
  type CreateTokenMeterOptions,
} from './token-meter.js';
export { calculateCost, type UsageCounts, type ModelCost } from './cost-aggregator.js';
export { computeCacheHitRatio, ratioFromCounts, type CacheHitSummary } from './cache-hit.js';
export type {
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
  TokenMeter,
  TaskTokenUsage,
} from './types.js';
