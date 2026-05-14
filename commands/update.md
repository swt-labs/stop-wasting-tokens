---
name: swt:update
category: advanced
disable-model-invocation: true
description: Update SWT to the latest version with automatic cache refresh.
argument-hint: '[--check]'
allowed-tools: Read, Bash, Glob
---

# SWT Update $ARGUMENTS

## Context

Plugin root: `${SWT_INSTALL_ROOT}`

Store the plugin root path output above as `{plugin-root}` for use in file/script lookups below. Replace `{plugin-root}` with the literal `Plugin root` value from Context whenever a step below references a script or file in the installed plugin.

**Resolve config directory:** Try in order: env var `SWT_CONFIG_DIR` (if set and directory exists), `~/.config/claude-code` (if exists), otherwise `~/.claude`. Store result as `CLAUDE_DIR`. Use for all config paths below.

## Steps

### Step 1: Read current INSTALLED version

Read the **cached** version (what user actually has installed):

```bash
for _d in "${SWT_CONFIG_DIR:-}" "$HOME/.config/claude-code" "$HOME/.claude"; do [ -z "$_d" ] && continue; v=$(cat "$_d"/plugins/cache/*/VERSION 2>/dev/null | sort -V | tail -1 || true); [ -n "$v" ] && echo "$v" && break; done
```

Store as `old_version`. If empty, fall back to `{plugin-root}/VERSION`.

**CRITICAL:** Do NOT read `{plugin-root}/VERSION` as primary — in dev sessions it resolves to source repo (may be ahead), causing false "already up to date."

### Step 2: Handle --check

If `--check`: display version banner with installed version and STOP.

### Step 3: Check for update

```bash
curl -sf --max-time 5 "https://raw.githubusercontent.com/yidakee/vibe-better-with-claude-code-vbw/main/VERSION"
```

Store as `remote_version`. Curl fails → STOP: "⚠ Could not reach GitHub to check for updates."
If remote == old: display "✓ Already at latest (v{old_version}). Refreshing cache..." Continue to Step 4 for clean cache refresh.

### Step 4: Nuclear cache wipe

```bash
bash "{plugin-root}/scripts/cache-nuke.sh"
```

Removes CLAUDE_DIR/plugins/cache/, CLAUDE_DIR/commands/vbw/, /tmp/swt-\* for pristine update.

### Step 5: Perform update

Same version: "Refreshing SWT v{old_version} cache..." Different: "Updating SWT v{old_version}..."

**CRITICAL: All `claude plugin` commands MUST be prefixed with `unset CLAUDECODE &&`** — without this, Claude Code detects the parent session's env var and blocks with "cannot be launched inside another Claude Code session."

**Refresh marketplace FIRST** (stale checkout → plugin update re-caches old code):

```bash
unset CLAUDECODE && claude plugin marketplace update swt-marketplace 2>&1
```

If fails: "⚠ Marketplace refresh failed — trying update anyway..."

Try in order (stop at first success):

- **A) Platform update:** `unset CLAUDECODE && claude plugin update vbw@swt-marketplace 2>&1`
- **B) Reinstall:** `unset CLAUDECODE && claude plugin uninstall vbw@swt-marketplace 2>&1 && unset CLAUDECODE && claude plugin install vbw@swt-marketplace 2>&1`
- **C) Manual fallback:** display commands for user to run manually, STOP.

**Clean stale global commands** (after A or B succeeds):

```bash
for _d in "${SWT_CONFIG_DIR:-}" "$HOME/.config/claude-code" "$HOME/.claude"; do [ -z "$_d" ] && continue; rm -rf "$_d/commands/vbw" 2>/dev/null; done
```

This removes stale copies that break `{plugin-root}` resolution. Commands load from the plugin cache where the resolved plugin root is guaranteed.

### Step 5.5: Ensure SWT statusline

Read `CLAUDE_DIR/settings.json`, check `statusLine` (string or object .command). If contains `swt-statusline`: skip. Otherwise update to:

```json
{
  "type": "command",
  "command": "bash -c 'for _d in \"${SWT_CONFIG_DIR:-}\" \"$HOME/.config/claude-code\" \"$HOME/.claude\"; do [ -z \"$_d\" ] && continue; f=$(ls -1 \"$_d\"/plugins/cache/*/scripts/swt-statusline.sh 2>/dev/null | sort -V | tail -1 || true); [ -f \"$f\" ] && exec bash \"$f\"; done'"
}
```

Use jq to write (backup, update, restore on failure). Display `✓ Statusline restored (restart to activate)` if changed.

### Step 6: Verify update

```bash
NEW_CACHED=$(for _d in "${SWT_CONFIG_DIR:-}" "$HOME/.config/claude-code" "$HOME/.claude"; do [ -z "$_d" ] && continue; v=$(cat "$_d"/plugins/cache/*/VERSION 2>/dev/null | sort -V | tail -1 || true); [ -n "$v" ] && echo "$v" && break; done)
```

Use NEW_CACHED as authoritative version. If empty or equals old_version when it shouldn't: "⚠ Update may not have applied. Try swt update again after restart."

### Step 7: Display result

Use NEW_CACHED for all display. Same version = "SWT Cache Refreshed" banner + "Changes active immediately". Different = "SWT Updated" banner with old→new + "Changes active immediately" + "swt whats-new" suggestion.

**Edge case:** If Step 6 verification failed (NEW_CACHED empty/unchanged when upgrade expected): keep restart suggestion as diagnostic fallback.

## Output Format

Follow @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md — double-line box, ✓ success, ⚠ fallback warning, Next Up, no ANSI.
