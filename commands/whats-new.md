---
name: swt:whats-new
category: advanced
disable-model-invocation: true
description: View changelog and recent updates since your installed version.
argument-hint: "[version]"
allowed-tools: Read, Glob
---

# SWT What's New $ARGUMENTS

## Context

Plugin root: `${SWT_INSTALL_ROOT}`

Store the plugin root path output above as `{plugin-root}` for use in file lookups below. Replace `{plugin-root}` with the literal `Plugin root` value from Context whenever a step below references VERSION or CHANGELOG.md.

## Guard

1. **Missing changelog:** `{plugin-root}/CHANGELOG.md` missing → STOP: "No CHANGELOG.md found."

## Steps

1. Read `{plugin-root}/VERSION` for current_version.
2. Read `{plugin-root}/CHANGELOG.md`, split by `## [` headings.
   - With version arg: show entries newer than that version.
   - No args: show current version's entry.
3. Display Phase Banner "SWT Changelog" with version context, entries, Next Up (swt help). No entries: "✓ No changelog entry found for v{version}."

## Output Format

Follow @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md — double-line box, ✓ up-to-date, Next Up, no ANSI.
