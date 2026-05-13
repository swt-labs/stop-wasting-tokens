---
name: swt:uninstall
category: advanced
disable-model-invocation: true
description: Cleanly remove all SWT traces from the system before plugin uninstall.
argument-hint:
allowed-tools: Read, Write, Edit, Bash, Glob, AskUserQuestion
---

# SWT Uninstall

## Context

Settings:
```
!`for _d in "${SWT_CONFIG_DIR:-}" "$HOME/.config/claude-code" "$HOME/.claude"; do [ -z "$_d" ] && continue; [ -f "$_d/settings.json" ] && cat "$_d/settings.json" 2>/dev/null && break; done || echo "{}"`
```
Planning dir:
```text
!`ls -d .swt-planning 2>/dev/null && echo "EXISTS" || echo "NONE"`
```
CLAUDE.md:
```text
!`ls CLAUDE.md 2>/dev/null && echo "EXISTS" || echo "NONE"`
```

## Steps

**Resolve config directory:** Try in order: env var `SWT_CONFIG_DIR` (if set and directory exists), `~/.config/claude-code` (if exists), otherwise `~/.claude`. Store result as `CLAUDE_DIR`.

### Step 1: Confirm intent

Display Phase Banner "SWT Uninstall" explaining system-level config removal. Project files handled separately. Ask confirmation.

### Step 2: Clean statusLine

Read `CLAUDE_DIR/settings.json`. If statusLine contains `swt-statusline`: remove entire statusLine key, display ✓. If not SWT's: "○ Statusline is not SWT's — skipped".

### Step 3: Clean Agent Teams env var

If `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` exists: ask user (it's a Claude Code feature other tools may use). Approved: remove (if env then empty, remove env key). Declined: "○ Agent Teams setting kept".

### Step 4: Project data

If `.swt-planning/` exists: ask keep (recommended) or delete. Delete: `rm -rf .swt-planning/`.

### Step 5: CLAUDE.md cleanup

If CLAUDE.md exists: ask keep or delete.

### Step 6: Summary

Display Phase Banner "SWT Cleanup Complete" with ✓/○ per step. Then:
```
➜ Final Step
  /plugin uninstall vbw@swt-marketplace
  Then optionally: /plugin marketplace remove swt-marketplace
```
**Do NOT run plugin uninstall yourself** — it would remove itself mid-execution.

## Output Format

Follow @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md — Phase Banner (double-line box), ✓ completed, ○ skipped, Next Up, no ANSI.
