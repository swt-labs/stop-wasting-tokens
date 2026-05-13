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
Plugin root:
```
!`SWT_CACHE_ROOT="${SWT_CONFIG_DIR:-$HOME/.claude}/plugins/cache/swt-marketplace/vbw"; SESSION_KEY="${SWT_SESSION_ID:-default}"; SESSION_LINK="/tmp/.swt-install-root-link-${SESSION_KEY}"; R=""; if [ -n "${SWT_INSTALL_ROOT:-}" ] && [ -f "${SWT_INSTALL_ROOT}/scripts/hook-wrapper.sh" ]; then R="${SWT_INSTALL_ROOT}"; fi; if [ -z "$R" ] && [ -f "${SWT_CACHE_ROOT}/local/scripts/hook-wrapper.sh" ]; then R="${SWT_CACHE_ROOT}/local"; fi; if [ -z "$R" ]; then V=$(find "${SWT_CACHE_ROOT}" -maxdepth 1 -mindepth 1 2>/dev/null | awk -F/ '{print $NF}' | grep -E '^[0-9]+(\.[0-9]+)*$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1); [ -n "$V" ] && [ -f "${SWT_CACHE_ROOT}/${V}/scripts/hook-wrapper.sh" ] && R="${SWT_CACHE_ROOT}/${V}"; fi; if [ -z "$R" ]; then L=$(find "${SWT_CACHE_ROOT}" -maxdepth 1 -mindepth 1 2>/dev/null | awk -F/ '{print $NF}' | sort | tail -1); [ -n "$L" ] && [ -f "${SWT_CACHE_ROOT}/${L}/scripts/hook-wrapper.sh" ] && R="${SWT_CACHE_ROOT}/${L}"; fi; if [ -z "$R" ] && [ -f "${SESSION_LINK}/scripts/hook-wrapper.sh" ]; then R="${SESSION_LINK}"; fi; if [ -z "$R" ]; then ANY_LINK=$(command find -H /tmp -maxdepth 1 -name '.swt-plugin-root-link-*' -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r link; do if [ -f "$link/scripts/hook-wrapper.sh" ]; then printf '%s\n' "$link"; break; fi; done || true); [ -n "$ANY_LINK" ] && R="$ANY_LINK"; fi; if [ -z "$R" ]; then D=$(ps axww -o args= 2>/dev/null | grep -v grep | grep -oE -- "--plugin-dir [^ ]+" | head -1); D="${D#--plugin-dir }"; [ -n "$D" ] && [ -f "$D/scripts/hook-wrapper.sh" ] && R="$D"; fi; if [ -z "$R" ] || [ ! -d "$R" ]; then echo "SWT: plugin root resolution failed" >&2; exit 1; fi; LINK="${SESSION_LINK}"; REAL_R=$(cd "$R" 2>/dev/null && pwd -P) || { echo "SWT: plugin root canonicalization failed" >&2; exit 1; }; bash "$REAL_R/scripts/ensure-plugin-root-link.sh" "$LINK" "$REAL_R" >/dev/null 2>&1 || { echo "SWT: plugin root link failed" >&2; exit 1; }; bash "$LINK/scripts/phase-detect.sh" > "/tmp/.swt-phase-detect-${SESSION_KEY}.txt" 2>/dev/null || echo "phase_detect_error=true" > "/tmp/.swt-phase-detect-${SESSION_KEY}.txt"; echo "$LINK"`
```

Pre-computed state (via phase-detect.sh):
```
!`SESSION_KEY="${SWT_SESSION_ID:-default}"
L="/tmp/.swt-install-root-link-${SESSION_KEY}"
P="/tmp/.swt-phase-detect-${SESSION_KEY}.txt"
PD=""
_refresh_phase_detect() {
  local SWT_CACHE_ROOT R V D REAL_R
  SWT_CACHE_ROOT="${SWT_CONFIG_DIR:-$HOME/.claude}/plugins/cache/swt-marketplace/vbw"
  R=""
  if [ -z "$R" ] && [ -n "${SWT_INSTALL_ROOT:-}" ] && [ -f "${SWT_INSTALL_ROOT}/scripts/hook-wrapper.sh" ]; then R="${SWT_INSTALL_ROOT}"; fi
  if [ -z "$R" ] && [ -f "${SWT_CACHE_ROOT}/local/scripts/hook-wrapper.sh" ]; then R="${SWT_CACHE_ROOT}/local"; fi
  if [ -z "$R" ]; then
    V=$(find "${SWT_CACHE_ROOT}" -maxdepth 1 -mindepth 1 2>/dev/null | awk -F/ '{print $NF}' | grep -E '^[0-9]+(\.[0-9]+)*$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
    [ -n "$V" ] && [ -f "${SWT_CACHE_ROOT}/${V}/scripts/hook-wrapper.sh" ] && R="${SWT_CACHE_ROOT}/${V}"
  fi
  if [ -z "$R" ]; then
    V=$(find "${SWT_CACHE_ROOT}" -maxdepth 1 -mindepth 1 2>/dev/null | awk -F/ '{print $NF}' | sort | tail -1)
    [ -n "$V" ] && [ -f "${SWT_CACHE_ROOT}/${V}/scripts/hook-wrapper.sh" ] && R="${SWT_CACHE_ROOT}/${V}"
  fi
  SESSION_LINK="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}"
  if [ -z "$R" ] && [ -f "$SESSION_LINK/scripts/hook-wrapper.sh" ]; then
    R="$SESSION_LINK"
  fi
  if [ -z "$R" ]; then
    ANY_LINK=$(command find -H /tmp -maxdepth 1 -name '.swt-plugin-root-link-*' -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r link; do
      if [ -f "$link/scripts/hook-wrapper.sh" ]; then
        printf '%s\n' "$link"
        break
      fi
    done || true)
    [ -n "$ANY_LINK" ] && R="$ANY_LINK"
  fi
  if [ -z "$R" ]; then
    D=$(ps axww -o args= 2>/dev/null | grep -v grep | grep -oE -- "--plugin-dir [^ ]+" | head -1)
    D="${D#--plugin-dir }"
    [ -n "$D" ] && [ -f "$D/scripts/hook-wrapper.sh" ] && R="$D"
  fi
  if [ -z "$R" ] || [ ! -d "$R" ] || [ ! -f "$R/scripts/phase-detect.sh" ]; then
    return 1
  fi
  REAL_R=$(cd "$R" 2>/dev/null && pwd -P) || return 1
  bash "$REAL_R/scripts/ensure-plugin-root-link.sh" "$L" "$REAL_R" >/dev/null 2>&1 || true
  PD=$(bash "$REAL_R/scripts/phase-detect.sh" 2>/dev/null) || PD=""
  if [ -z "$(printf '%s' "$PD" | tr -d '[:space:]')" ] || [ "$PD" = "phase_detect_error=true" ]; then
    return 1
  fi
  printf '%s' "$PD" > "$P"
  return 0
}
if ! _refresh_phase_detect; then
  PD="phase_detect_error=true"
  printf '%s\n' "$PD" > "$P"
fi
[ -f "$P" ] && PD=$(cat "$P")
if [ -n "$(printf '%s' "$PD" | tr -d '[:space:]')" ] && [ "$PD" != "phase_detect_error=true" ]; then
  printf '%s' "$PD"
else
  echo "phase_detect_error=true"
fi`
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
