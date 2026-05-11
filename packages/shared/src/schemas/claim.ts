import { z } from 'zod';

/**
 * File-claim envelope written to `.swt-planning/parallel/wt-{task-id}/claim.json`
 * by `orchestration/claim-registry.ts` (lands in M3 PR-23). PR-04 establishes
 * the shape; M3 wires the registry that enforces it.
 *
 * Per TDD2 §9.2: claims serialise conflicting file edits within a phase. A
 * task without a claim cannot edit files declared by another running task.
 */
export const ClaimSchema = z.object({
  schema_version: z.literal(1),
  task_id: z.string().min(1),
  worktree_path: z.string().min(1),
  files: z.array(z.string().min(1)),
  acquired_at: z.string().datetime(),
  /**
   * Lease TTL in seconds (default 300 = 5 min). The worktree-manager renews
   * leases for long-running tasks (M3 PR-25); stale leases get reclaimed.
   */
  ttl_seconds: z.number().int().positive().default(300),
  pid: z.number().int().positive().optional(),
});

export type ClaimSchemaT = z.infer<typeof ClaimSchema>;
