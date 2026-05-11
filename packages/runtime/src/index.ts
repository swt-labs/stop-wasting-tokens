/**
 * Public surface for `@swt-labs/runtime` — Layer 1.
 *
 * In PR-04, types (SwtSession, SwtSessionOptions, SwtEvent, TokenMeter, …)
 * live in `@swt-labs/shared`. Runtime re-exports them so existing
 * `from '@swt-labs/runtime'` import sites for those types keep resolving.
 */

export { createSession } from './session.js';
export { createCodingTools, createReadOnlyTools } from './tools.js';
export { mapPiEvent } from './events.js';
export { probePiAvailable, type ProbePiResult } from './probe.js';
export { MockSpawnerEnvironment } from './mock/MockSpawnerEnvironment.js';
export type {
  SwtSession,
  SwtSessionOptions,
  SwtEvent,
  TokenMeter,
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
} from '@swt-labs/shared';
