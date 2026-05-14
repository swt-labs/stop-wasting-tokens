---
name: swt:resume
category: supporting
disable-model-invocation: true
description: Restore project context from .swt-planning/ state.
argument-hint:
allowed-tools: Read, Bash, Glob
---

# SWT Resume

## Context

Working directory:

```
!`pwd`
```

Plugin root: `${SWT_INSTALL_ROOT}`

Pre-computed state (via phase-detect.sh):

```
${SWT_PHASE_DETECT_OUTPUT}
```

## Guard

1. **Not initialized** (no .swt-planning/ dir): STOP "Run swt init first."
2. **Brownfield normalization:** If Pre-computed state (from Context above) contains `misnamed_plans=true`, normalize all phase directories before proceeding:
   ```bash
   NORM_SCRIPT="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/normalize-plan-filenames.sh"
   if [ -f "$NORM_SCRIPT" ]; then
     for pdir in .swt-planning/phases/*/; do
       [ -d "$pdir" ] && bash "$NORM_SCRIPT" "$pdir"
     done
   fi
   ```
   Display: "⚠ Renamed misnamed plan files to `{NN}-PLAN.md` convention."
   Then re-run phase-detect.sh to refresh state:
   ```bash
   bash "/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/phase-detect.sh" > "/tmp/.swt-phase-detect-${SWT_SESSION_ID:-default}.txt"
   ```
   Use the refreshed phase-detect output for all subsequent steps.
3. **No roadmap:** `.swt-planning/ROADMAP.md` missing → STOP: "No roadmap found. Run swt cook."
4. **Phase-detect error:** If output contains `phase_detect_error=true`, display: "⚠ Phase detection failed. Run phase-detect.sh manually to debug." and STOP.

## Steps

1. **Read ground truth (top-level only):** Read these files from `.swt-planning/` (NOT from `milestones/` — those are archived):
   - `.swt-planning/PROJECT.md` — name, core value
   - `.swt-planning/STATE.md` — decisions, todos, blockers
   - `.swt-planning/ROADMAP.md` — phases overview
   - `.swt-planning/.execution-state.json` — interrupted builds
   - `.swt-planning/RESUME.md` — session notes
   - Glob `.swt-planning/phases/**/*-PLAN.md` and `.swt-planning/phases/**/*-SUMMARY.md` — plan/completion counts
   - Most recent SUMMARY.md from `.swt-planning/phases/` — last work
   - Skip missing files. **Never read from `.swt-planning/milestones/`.**
2. **Compute progress from phase-detect.sh output:** Use the pre-computed `phase_count`, `next_phase`, `next_phase_state`, `next_phase_plans`, `next_phase_summaries`, `uat_issues_phase`, `uat_issues_slug`, `uat_issues_phases`, and `uat_issues_count` values. Map `next_phase_state` to display: `needs_uat_remediation` → "⚠ Needs remediation", `needs_verification` → "⏳ Needs UAT verification", `needs_plan_and_execute` → "not started", `needs_execute` → "in progress", `all_done` → "complete". **Per-phase status:** any phase whose number appears in the comma-separated `uat_issues_phases` list has unresolved UAT issues — mark it "⚠ Needs remediation". Only mark a phase as "✓ Done" if its number is NOT in `uat_issues_phases` and it has completed execution (SUMMARY count ≥ PLAN count). Phases not yet executed are "not started".
   **Known issues check:** For each phase directory, run:
   ```bash
   bash "/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/track-known-issues.sh" promote-todos "{phase-dir}" 2>/dev/null || true
   bash "/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/track-known-issues.sh" status "{phase-dir}" 2>/dev/null
   ```
   Parse `known_issues_count` from the status output. For each phase with `known_issues_count > 0`, include in the dashboard after the phase table: `⚠ Phase {NN}: N known issue(s) deferred — run swt list-todos to review`. Omit for phases with zero known issues. The `promote-todos` call is a backfill — it ensures any known issues not yet in `STATE.md ## Todos` are promoted on resume.
3. **Detect interrupted builds:** If `.execution-state.json` status="running": all SUMMARYs present = completed since last session; some missing = interrupted.
4. **Present dashboard:** Phase Banner "Context Restored / {project name}" with: core value, phase/progress, overall progress bar, key decisions, todos, blockers (⚠), last completed, build status (✓ completed / ⚠ interrupted), session notes. Run `bash /tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/suggest-next.sh resume`.

## Output Format

Follow @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md — double-line box, Metrics Block, ⚠ warnings, ✓ completions, ➜ Next Up, no ANSI.
