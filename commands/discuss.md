---
name: swt:discuss
category: lifecycle
description: 'Start or continue phase discussion to build context before planning.'
argument-hint: '[N] [--assumptions]'
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, LSP
disable-model-invocation: true
---

# SWT Discuss: $ARGUMENTS

## Context

Working directory:

```
!`pwd`
```

Plugin root: `${SWT_INSTALL_ROOT}`

Store the plugin root path output above as `{plugin-root}` for use in script/reference lookups below. Replace `{plugin-root}` with the literal `Plugin root` value from Context whenever a step below references a script or reference file.

Phase state:

```
${SWT_PHASE_DETECT_OUTPUT}
```

!`L="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}"; i=0; while [ ! -L "$L" ] && [ $i -lt 20 ]; do sleep 0.1; i=$((i+1)); done; bash "$L/scripts/suggest-compact.sh" discuss 2>/dev/null || true`

## Guards

- No `.swt-planning/` directory: STOP "Run swt init first."
- No phases in ROADMAP.md: STOP "No phases defined. Run swt cook first."

## Phase Resolution

1. If `$ARGUMENTS` contains a number N, target phase N.
2. If the target phase has a `*-CONTEXT.md` file with `pre_seeded: true` in its YAML frontmatter (remediation phase): WARN the user that this phase has pre-seeded UAT context and ask whether they want to re-discuss (which overwrites the pre-seeded content) or skip discussion and proceed to planning.
3. If the target phase has a `*-CONTEXT.md` file WITHOUT `pre_seeded: true` (organic discussion already happened): This is a **continuation discussion**. Display: "Phase {NN} already has discussion context. Continuing to explore additional topics." The Discussion Engine's Step 1.5 will handle loading existing decisions as baseline.
4. If no target was set by step 1 (no explicit phase number): auto-detect by finding the first phase directory without a `*-CONTEXT.md` file. If all phases already have context: STOP "All phases discussed. Specify a phase number to deepen an existing discussion."

## Discussion Mode Resolution

Determine the discussion mode before invoking the engine:

1. If `$ARGUMENTS` contains `--assumptions` → mode is `assumptions`
2. Else read `discussion_mode` from `.swt-planning/config.json` (via `jq -r '.discussion_mode // "questions"'`)
3. If config value is `"assumptions"` → mode is `assumptions`
4. If config value is `"auto"` and `.swt-planning/codebase/META.md` exists → mode is `assumptions`
5. Otherwise → mode is `questions`

Pass the resolved mode to the engine: "Discussion mode: {resolved_mode}"

## Execute

Read `{plugin-root}/references/discussion-engine.md` and follow its protocol for the target phase. The engine's Step 1.7 uses the resolved discussion mode to branch between assumptions and questions paths.

## After Discussion

**Discussion commit boundary (conditional):**

```bash
PG_SCRIPT="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/planning-git.sh"
if [ -f "$PG_SCRIPT" ]; then
  bash "$PG_SCRIPT" commit-boundary "discuss phase {NN}" .swt-planning/config.json
else
  echo "SWT: planning-git.sh unavailable; skipping planning git boundary commit" >&2
fi
```

Behavior: `planning_tracking=commit` commits `{NN}-CONTEXT.md` and `discovery.json` if changed. Other modes no-op.

Run `bash /tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/suggest-next.sh discuss`.
