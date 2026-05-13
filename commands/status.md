---
name: swt:status
category: monitoring
disable-model-invocation: true
description: Display project progress dashboard with phase status, velocity metrics, and next action.
argument-hint: [--verbose] [--metrics]
allowed-tools: Read, Glob, Grep, Bash, LSP
---

# SWT Status $ARGUMENTS

## Context

Working directory:
```
!`pwd`
```
Plugin root: `${SWT_INSTALL_ROOT}`

Current state:
```
!`head -40 .swt-planning/STATE.md 2>/dev/null || echo "No state found"`
```

Roadmap:
```
!`head -50 .swt-planning/ROADMAP.md 2>/dev/null || echo "No roadmap found"`
```

Config: Pre-injected by SessionStart hook. Read .swt-planning/config.json only if --verbose.

Phase directories:
```
!`ls .swt-planning/phases/ 2>/dev/null || echo "No phases directory"`
```

Phase state:
```
${SWT_PHASE_DETECT_OUTPUT}
```

Shipped milestones:
```
!`ls -d .swt-planning/milestones/*/SHIPPED.md 2>/dev/null || echo "No shipped milestones"`
```

## Guard

- Not initialized (no .swt-planning/ dir): STOP "Run swt init first."
- **Brownfield normalization:** If Phase state (from Context above) contains `misnamed_plans=true`, normalize all phase directories before proceeding:
  ```bash
  NORM_SCRIPT="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/normalize-plan-filenames.sh"
  if [ -f "$NORM_SCRIPT" ]; then
    for pdir in .swt-planning/phases/*/; do
      [ -d "$pdir" ] && bash "$NORM_SCRIPT" "$pdir"
    done
  fi
  ```
  Display: "⚠ Renamed misnamed plan files to `{NN}-PLAN.md` convention."
  Then re-run phase-detect.sh to refresh state (filenames changed):
  ```bash
  bash "/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/phase-detect.sh" > "/tmp/.swt-phase-detect-${SWT_SESSION_ID:-default}.txt"
  ```
  Use the refreshed phase-detect output for all subsequent steps.
- No ROADMAP.md or has template placeholders: STOP "No roadmap found. Run swt cook to set up your project."

## Steps

1. **Parse args:** --verbose shows per-plan detail within each phase
2. **Resolve paths:** Use `.swt-planning/phases/` for phase directories. Gather milestone list from `.swt-planning/milestones/` (dirs with SHIPPED.md).
3. **Read data:** (STATE.md and ROADMAP.md use compact format -- flat fields, no verbose prose)
   - STATE.md: project name, current phase (flat `Phase:`, `Plans:`, `Progress:` lines), velocity
   - ROADMAP.md: phases, status markers, plan counts (compact per-phase fields, Progress table)
   - SessionStart injection: effort, autonomy. If --verbose, read config.json
   - Phase dirs: glob `*-PLAN.md` and `*-SUMMARY.md` per phase for completion data
   - If Agent Teams build active: read shared task list for teammate status
   - Cost ledger: if `.swt-planning/.cost-ledger.json` exists, read with jq. Extract per-agent costs. Compute total. Only display economy if total > 0.
4. **Compute progress:** Per phase: count PLANs (total) vs SUMMARYs (done). Pct = done/total * 100. Status: ✓ (100%), ◆ (1-99%), ○ (0%).
5. **Compute velocity:** Total plans done, avg duration, total time. If --verbose: per-phase breakdown.
6. **Next action:** Find first incomplete phase. Has plans but not all summaries: `swt cook` (auto-executes). Complete + next unplanned: `swt cook` (auto-plans). All complete: `swt cook --archive`. No plans anywhere: `swt cook`.

## Display

Per @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md:

**Header:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{project-name}
{progress-bar} {percent}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Multi-milestone** (if multiple):
```
  Milestones:
    ◆ {active-slug}    {bar} {%}  ({done}/{total} phases)
    ○ {other-slug}     {bar} {%}  ({done}/{total} phases)
```

**Phases:** `✓/◆/○ Phase N: {name}  {██░░} {%}  ({done}/{total} plans)`. If --verbose, indent per-plan detail with duration.

**Agent Teams** (if active): `◆/✓/○ {Agent}: Plan {NN} ({status})`

**Velocity:**
```
  Velocity:
    Plans completed:  {N}
    Average duration: {time}
    Total time:       {time}
```

**Economy** (only if .cost-ledger.json exists AND total > $0.00): Read ledger with jq. Sort agents by cost desc. Show dollar + pct per agent. Include cache hit rate if available.
```
  Economy:
    Total cost:   ${total}
    Per agent:
      Dev          $0.82   70%
      Lead         $0.15   13%
    Cache hit rate: {percent}%
```

  **RTK external metrics** (only when `--metrics` is explicit): run `bash /tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/rtk-manager.sh status --json --stats`. If RTK is absent, show nothing. If RTK is present, show one compact line labeled external, for example `RTK external: verified by runtime smoke proof, 47% avg savings`, `RTK external: active, 47% avg savings`, or `RTK external: hook active, compatibility unverified`. Use compatibility-unverified wording only for `risk` or `hook_active_unverified` states without proof. RTK savings are external RTK savings, not SWT savings. Default `swt status` avoids RTK history, stats, network, and smoke work to prevent recurring overhead; it must not advertise RTK when absent.

**Next Up:** Run `bash /tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/suggest-next.sh status` and display.
