# Orchestration — DAG Resolver

> **Status:** stub — populated at M3 (DAG resolver lands).
>
> **Canonical reference:** [`TDD2.md` §9](../../TDD2.md).
> **Implementing package:** `packages/orchestration/src/dag-resolver.ts` (M3 PR-24).

Tasks in a phase declare `depends_on: [taskId, ...]` in `plan-NN.md` frontmatter. The DAG resolver topologically sorts the task list into wave batches: each wave runs in parallel; the next wave starts only after all of the prior wave's tasks complete. Cycle detection rejects malformed `depends_on` chains at plan-load time, not at dispatch time.

M3 PR-24 ships the resolver. Plan 01-02 PR-09's dispatcher already accepts `HarvestStrategy` so DAG-driven parallel batches slot in without reshaping the dispatcher surface.

This page expands at M3.
