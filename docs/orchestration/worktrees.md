# Orchestration — Worktrees

> **Status:** stub — populated at M3 (parallel dispatcher lands).
>
> **Canonical reference:** [`TDD2.md` §9.2](../../TDD2.md).
> **Implementing package:** `packages/orchestration/src/worktree-manager.ts` (M3 PR-22).
> **Owning ADRs:** [ADR-008 — One git worktree per dispatched task](../decisions/ADR-008-worktree-per-task.md) · [ADR-009 — Windows worktree path discipline](../decisions/ADR-009-windows-worktree-path-discipline.md).

Each dispatched task in v3 gets its own git worktree at `.swt-planning/parallel/wt-<task-id>/`. Pi sessions are created with `cwd: worktreePath`. Tool factories scope filesystem access to the worktree — claim violations fail at the OS level, not just at the orchestrator layer.

M3 PR-22 ships the worktree manager; M3 PR-30 ships the Windows path discipline (POSIX paths internally, 200-char cap, forced LF via `.gitattributes`).

This page expands at M3.
