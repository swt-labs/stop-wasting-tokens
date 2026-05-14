# Worktree isolation

Operator-facing reference for the `worktree_isolation` config flag (Plan 06-03, R6).

## What it does

`worktree_isolation` lives in `.swt-planning/config.json`. Three values:

| Value    | Behavior                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'off'`  | **Default (v3.0).** Orchestrator + every teammate share the project's main working tree. Concurrent `git add` calls from parallel teammates race on the shared staging-area index.                              |
| `'on'`   | Each `swt cook` invocation runs in its own git worktree at `.swt-planning/parallel/wt-<taskId>/`. The orchestrator's index is ringfenced — no concurrent `git add` race against any other cook turn or process. |
| `'auto'` | Equivalent to `'on'` when the active phase carries 2+ parallel plans; equivalent to `'off'` otherwise. Lets the orchestrator decide instead of pinning a global default.                                        |

When the flag is `'off'` AND the active phase carries 2+ parallel plans, `swt cook` emits a one-time stderr warning + a `cook.worktree_isolation_warning` event on the JSONL channel at runMode start. Operators see a clear opt-in signal before the race window opens.

## Phase 4 Wave 2 race-condition recap

Phase 4's Wave 2 shipped two plans (`04-04` + `04-05`) in parallel. Two teammates ran concurrent `git add <their-files>` against the shared staging area, then each committed. Because `git add` is non-atomic against the index, the resulting commits surfaced misleading subjects — teammate A's commit subject pointed at files teammate B had staged, and vice versa.

Commits `7431a02` + `05ebd94` carry the visible symptom in `git log`. The fix in v3.1 (when `'on'` becomes the default) is structural: each teammate runs in its own worktree with its own `.git/index`, so cross-staging is impossible.

See research §2.2 + `.vbw-planning/phases/04-dashboard-statusline/PARITY-REPORT.md:127` for the original incident write-up.

## Recommended setting

- **Solo developer, single cook turn at a time, no parallel plans in a phase:** `'off'` is fine. The race only fires when ≥2 cook turns interleave.
- **Phase carries 2+ parallel plans (any wave with 2+ same-wave entries):** flip to `'on'` in `.swt-planning/config.json`. Phase 6 (with Wave 2 = 06-02 + 06-03) is the canonical example.
- **Power users who run multiple `swt cook` invocations in different terminals against the same repo:** `'on'` (the staging-area race is the same whether the two cooks come from the same phase or unrelated commands).

To set:

```json
{
  "worktree_isolation": "on"
}
```

No CLI flag — the value is read at every `swt cook` invocation from disk.

## Lifecycle (FSM states)

Same FSM as the standalone `WorktreeManager` from M3 PR-22. The cook handler drives:

```
none → created → claimed → dispatched → agent_running → agent_complete → harvested → removed
                                                                                       │
                                                                                       └→ failed (any non-terminal)
```

- **Success path:** `removed`. The per-task lock at `.swt-planning/locks/task-<taskId>.lock` is released; the `.swt-planning/parallel/wt-<taskId>/` directory is reaped via `git worktree remove`.
- **Failure path:** `failed`. The worktree directory + lock are **kept on disk for forensics** per TDD2 §9.7. Operators inspect the worktree, then drop it via `swt cleanup` (which understands the FSM via the journal at `.swt-planning/journal/wt-<taskId>.jsonl`).

The cook handler also writes a stderr breadcrumb on transition:

```
swt cook: [worktree-isolation] worktree kept at .swt-planning/parallel/wt-<taskId>/ for forensics (spawn_failed).
```

The bash-side scripts that already ship (`scripts/worktree-create.sh`, `worktree-cleanup.sh`, `worktree-merge.sh`, `worktree-status.sh`, `worktree-agent-map.sh`) are consumed by the orchestrator's lead role when the lead spawns per-teammate sub-worktrees; the TS-side `WorktreeManager` owns the orchestrator's outer worktree. The two layers are independent — using `worktree_isolation: 'on'` works whether or not the orchestrator's lead reaches for the bash scripts.

## v3.1 default-flip plan

R6 (Plan 06-03 decision): keep `'off'` for v3.0; flip to `'on'` in v3.1.

The flip is gated on three signals from Phase 6 stability evidence:

1. **No regression reports for 30 days post-v3.0.** If users surface unknown downstream-caller breakage, the v3.1 default stays `'off'`.
2. **Chaos test `test/regression/worktree-isolation-race.test.ts` stays green in CI.** The test runs two teammates concurrently `git add`'ing disjoint files inside their respective worktrees and asserts no cross-staging.
3. **`swt cleanup` retention test confirms no lock-file leaks.** Failed worktrees must be reapable via `swt cleanup`; lock files left behind from earlier runs must purge cleanly.

When the flip lands, `.swt-planning/config.json#worktree_isolation` (and the corresponding `core/src/config/Config.ts` zod default) becomes `'on'`. Operators who want the old behavior can pin it to `'off'` per-repo.

## Troubleshooting

**Q: `swt cook` printed `[worktree-isolation] WARNING: worktree acquisition failed (...)` — what now?**

Worktree creation fell back to the shared working tree for this run. The cook turn proceeds without isolation. Common causes:

- `.swt-planning/parallel/wt-<taskId>/` already exists from a prior failed run that wasn't cleaned. Run `swt cleanup` (or remove the directory manually after checking the journal at `.swt-planning/journal/wt-<taskId>.jsonl`).
- `git worktree add` failed because the base ref (HEAD) is ambiguous (e.g., a detached-HEAD state mid-rebase). Resolve the rebase / checkout a named branch + retry.
- Path length exceeds 200 chars on Windows. Move the project to a shorter root.

**Q: After a `'on'` cook turn, my work is on a worktree branch instead of `main`.**

Today's wiring drops the worktree after `git worktree remove` — any commits made inside the worktree stay on the worktree's branch. Merge integration into the operator's main branch is **v3.1 scope**; for v3.0, manually `git merge <worktree-branch>` if commits matter.

**Q: How do I see which worktrees exist right now?**

```
git worktree list
ls .swt-planning/parallel/
ls .swt-planning/locks/
cat .swt-planning/journal/wt-<taskId>.jsonl
```

The dashboard's Worktrees panel surfaces the same data via SSE from `registerWorktreesRoute`.
