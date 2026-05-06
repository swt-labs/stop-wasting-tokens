---
name: swt-execute
description: Execute a planned SWT phase. Runs Dev agents through every PLAN.md task, commits each task atomically, then writes SUMMARY.md. Use when the user wants to build, ship, run, or execute a phase that already has a plan. Triggered by "execute phase N", "swt execute", "build it", "ship it", "run the plan", "go".
---

# swt-execute

This skill drives the Dev agent through a planned phase.

## When to use

- A `.swt-planning/phases/<NN>-<slug>/<NN>-<MM>-PLAN.md` exists.
- The user types something like "execute phase N", "swt execute", "build it", "ship it", "run the plan", or "go".

## What this skill does

1. Reads PLAN.md and identifies pending tasks (no matching SUMMARY.md section yet).
2. For each wave, spawns Dev agents. Within a wave plans are independent, so they can run as a real team. Across waves, ordering is strict.
3. Each Dev task ends with one Conventional-Commits commit and a `## Task <N>` section in SUMMARY.md.
4. After the last task, the SUMMARY.md frontmatter is finalised with `status`, `tasks_completed`, `tasks_total`, `commit_hashes`, `files_modified`, and `deviations`.
5. If `--skip-qa` was not set, hands off to swt-qa next.
