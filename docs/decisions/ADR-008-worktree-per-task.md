---
adr: 008
title: One git worktree per dispatched task
status: Accepted
decided: 2026-05-11
accepted: 2026-05-12
pr: M3 PR-22
supersedes: TDD2 §9.2
related: ADR-009
---

# ADR-008 — One git worktree per dispatched task

**Status:** Accepted (2026-05-12 — M3 PR-22 landed the `WorktreeManager` lifecycle FSM at `packages/orchestration/src/worktree-manager.ts`)

## Context

M3 introduces parallel Dev tasks within a phase. Three problems immediately
surface when two agents edit the same repository in parallel:

1. **File conflicts** — both agents touch the same file; the later write
   silently overwrites the earlier one. Output looks fine until QA finds
   the missing change.
2. **Claim tracking** — without filesystem isolation, "task A claimed
   foo.ts" is an in-memory ledger that's invisible to git itself.
3. **Crash recovery** — if the orchestrator dies mid-batch, recovering the
   in-flight state means walking back through partial edits scattered
   across the working tree.

The two viable shapes for isolation are: (a) per-task worktrees (git's
native primitive); (b) per-task in-memory file maps that the orchestrator
materialises on demand. Option (b) is implementable but loses git's own
guarantees — `git status` no longer tells the truth — and surrenders most
of the chaos-testing surface (the FS itself is the crash domain).

## Decision

Each dispatched task gets its own git worktree at
`.swt-planning/parallel/wt-<task-id>/` via `git worktree add`. Pi sessions are
created with `cwd: worktreePath`. Tool factories scope filesystem access to
the worktree (the read-only / coding tool builders in `runtime/src/tools.ts`
take a base path and never write outside it). The claim registry
(`orchestration/src/claim-registry.ts`, M3 PR-23) tracks worktree → file
ownership; the worktree boundary makes claim violations fail at the OS
level, not just at the orchestrator layer.

Worktrees are torn down at task completion via `git worktree remove --force`.
The journal extension (PR-09's `journal.ts`) records create/remove events so
crash recovery can detect orphan worktrees and reclaim them.

`shared/src/types/dispatcher.ts` already declares `TaskBrief.cwd: string` —
M3 PR-22 changes the dispatcher to populate that field with the worktree
path; the methodology layer never sees a worktree directly.

## Consequences

Easier:

- Claim violations rejected at the filesystem boundary — the tool factory
  refuses to read/write outside `cwd`. No "orchestrator forgot to check
  claims" bug class.
- Crash recovery inspects a single directory per task; partial edits live
  alongside the worktree, not scattered.
- Parallel batches truly run in parallel — no inter-task FS contention.
- Chaos tests (M3 PR-28) get a clean "kill mid-task, did the right worktree
  recover?" assertion target.

Harder:

- git-worktree on Windows requires path discipline (ADR-009 — POSIX paths
  internally, 200-char cap, forced LF).
- Disk cost: ~50 MB per worktree on a medium repo. M3's parallelism cap
  defaults to 4 (configurable); 200 MB transient cost per phase.
- Worktree teardown can race with file handles (Windows). Mitigation:
  `git worktree remove --force` + retry with backoff; documented in §13.3.3.
