/**
 * Zod schema for `WorktreeState` per TDD2 §9.1.
 *
 * Sister to the TS type at `packages/shared/src/types/worktree.ts`.
 * Used by the lock-file envelope schema (PR-25) to validate the
 * `state` field on disk-persisted lock files; M3+ persisted journal
 * formats may also consume it.
 *
 * Order is meaningful — transitions only move forward through this
 * list (with `failed` reachable from any non-terminal state, enforced
 * by `WorktreeManager.assertCanTransition`).
 */

import { z } from 'zod';

export const WorktreeStateSchema = z.enum([
  'created',
  'claimed',
  'dispatched',
  'agent_running',
  'agent_complete',
  'harvested',
  'removed',
  'failed',
]);
