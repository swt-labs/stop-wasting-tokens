# Orchestration — Claims

> **Status:** stub — populated at M3 (claim registry lands).
>
> **Canonical reference:** [`TDD2.md` §9](../../TDD2.md).
> **Implementing package:** `packages/orchestration/src/claim-registry.ts` (M3 PR-23).
> **Owning ADR:** [ADR-008 — Worktree-per-task model](../decisions/ADR-008-worktree-per-task.md).

The claim registry tracks worktree → file ownership for parallel dispatches. A task claims the files it intends to modify; conflicting claims from concurrent tasks are rejected at registration time. The worktree boundary (per ADR-008) makes claim violations fail at the OS level — tool factories scoped to the worktree can't write outside it — so the registry is an upstream check against batches whose tasks would otherwise race.

M3 PR-23 ships the registry. This page expands then.
