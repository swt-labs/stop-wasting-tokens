/**
 * Re-export from `@swt-labs/shared` (PR-04 migration). The actual type
 * definitions moved from this file in PR-04; keeping the file as a thin
 * re-export gives existing intra-package imports `from './types.js'` a
 * one-cycle compat surface. v3.1.0 deletes this file.
 */
export type {
  SwtSession,
  SwtSessionOptions,
  SwtEvent,
  TokenMeter,
  MeterRecord,
  MeterSnapshot,
  MeterUpdate,
} from '@swt-labs/shared';
