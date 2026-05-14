---
name: swt:pause
category: supporting
disable-model-invocation: true
description: Save session notes for next time (state auto-persists).
argument-hint: [notes]
allowed-tools: Read, Write
---

# SWT Pause: $ARGUMENTS

## Context

Working directory:

```
!`pwd`
```

## Guard

1. **Not initialized** (no .swt-planning/ dir): STOP "Run swt init first."

## Steps

1. **Write notes:** If $ARGUMENTS has notes: write `.swt-planning/RESUME.md` with timestamp + notes + resume hint. If no notes: skip write.
2. **Present:** Phase Banner "Session Paused". Show notes path if saved. "State is always saved in .swt-planning/. Nothing to lose, nothing to remember." Next Up: swt resume.

## Output Format

Follow @${SWT_INSTALL_ROOT}/references/swt-brand-essentials.md — double-line box, ➜ Next Up, no ANSI.
