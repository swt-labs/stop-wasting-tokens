# Orchestration — Crash Recovery

> **Status:** stub — populated at M3 (chaos test suite lands).
>
> **Canonical reference:** [`TDD2.md` §9](../../TDD2.md).
> **Implementing tests:** `test/chaos/*.chaos.test.ts` (M3 PR-28).

M3 PR-28 ships the chaos suite. The contract: `SIGKILL` the orchestrator at every FSM transition; restart; the phase completes correctly. The journal extension (Plan 01-02 PR-09's `runtime/src/extensions/journal.ts`) is the on-disk substrate that makes recovery possible — every `SwtEvent` mirrored to `<cwd>/.swt-planning/journal/<UTC-day>.jsonl` is the recovery oracle.

Three sources of truth, in priority order, when reconstructing in-flight state:

1. The plan's task list + `depends_on` graph (frozen at plan write time).
2. Per-task SUMMARY.md files (terminal state — task already finished).
3. The journal (in-flight state — what happened since the last SUMMARY).

Resume rules + the chaos matrix (Linux/macOS/Windows × inject-at-each-transition) land at M3.

This page expands at M3.
