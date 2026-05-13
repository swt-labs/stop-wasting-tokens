---
name: swt:help
category: supporting
disable-model-invocation: true
description: Display all available SWT commands with descriptions and usage examples.
argument-hint: [command-name]
allowed-tools: Read, Glob, Bash
---

# SWT Help $ARGUMENTS

## Context

Plugin root: `${SWT_INSTALL_ROOT}`

Store the plugin root path output above as `{plugin-root}` for use in command lookups below. Replace `{plugin-root}` with the literal `Plugin root` value from Context whenever a step below references a command file.

## Behavior

### No args: Display all commands

Run the help output script and display the result exactly as-is (pre-formatted terminal output):

```
!`L="/tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}"; i=0; while [ ! -L "$L" ] && [ $i -lt 20 ]; do sleep 0.1; i=$((i+1)); done; bash "$L/scripts/help-output.sh" || echo "SWT: help-output.sh failed — run swt doctor for diagnostics"`
```

Display the output above verbatim. Do not reformat, summarize, or add commentary. The script dynamically reads all command files and generates grouped output.

### With arg: Display specific command details

Read `{plugin-root}/commands/{name}.md` (strip `vbw:` prefix if present). Display:
- **Name** and **description** from frontmatter
- **Category** from frontmatter
- **Usage:** `swt {name} {argument-hint}`
- **Arguments:** list from argument-hint with brief explanation
- **Related:** suggest 1-2 related commands based on category

If command not found: "⚠ Unknown command: {name}. Run swt help for all commands."
