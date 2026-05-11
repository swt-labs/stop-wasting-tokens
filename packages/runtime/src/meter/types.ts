/**
 * Meter-side type re-exports.
 *
 * The contract lives in `@swt-labs/shared/types/meter.ts` (TokenMeter,
 * MeterRecord, MeterSnapshot, MeterUpdate) per the Plan 01-01 PR-04
 * migration. This file re-exports them under the `runtime/meter` import
 * path so consumers can write either `from '@swt-labs/runtime/meter'`
 * (idiomatic) or `from '@swt-labs/shared'` (canonical) and both resolve.
 */

export type {
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
  TokenMeter,
  TaskTokenUsage,
} from '@swt-labs/shared';
