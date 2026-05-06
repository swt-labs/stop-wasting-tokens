---
name: swt-init
description: Initialise a new SWT project. Use when the user wants to bootstrap a fresh repo or migrate from VBW or another methodology layer. Sets up `.swt-planning/` with PROJECT.md, REQUIREMENTS.md, ROADMAP.md, and STATE.md. Triggered by phrases like "init swt", "set up SWT", "start a new SWT project", "swt init", "scaffold SWT".
---

# swt-init

This skill walks the user through SWT bootstrap.

## When to use

- The repository has no `.swt-planning/` directory yet.
- The user types something like "init swt", "set up SWT", "start a new SWT project", or runs `swt init`.

## What this skill does

1. Detects whether the repo is greenfield or brownfield.
2. Asks the user for project name, one-line description, and core value (or infers them when the codebase makes that obvious).
3. Drafts an initial REQUIREMENTS.md and ROADMAP.md from the user's description and any existing code.
4. Writes the four core artefacts to `.swt-planning/` and creates `phases/` per the roadmap.
5. Hands control back so the user can review or jump straight into planning Phase 1.

The skill never silently fabricates content: when the user has not stated something, the skill asks.
