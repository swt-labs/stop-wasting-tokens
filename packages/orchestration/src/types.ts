/**
 * Re-export from `@swt-labs/shared` (PR-04 migration). Mirrors runtime/'s
 * pattern — types moved out in PR-04; this file stays one cycle as a
 * thin re-export so intra-package `from './types.js'` imports keep
 * resolving. Deleted in v3.1.0.
 */
export type { Dispatcher, TaskBrief, TaskResult } from '@swt-labs/shared';
