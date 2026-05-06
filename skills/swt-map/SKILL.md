---
name: swt-map
description: Map an existing codebase into structured artefacts (STACK, ARCHITECTURE, PATTERNS, CONCERNS) for SWT to use as context. Use when a brownfield project needs to be brought into SWT or the codebase has changed substantially. Triggered by "map the codebase", "swt map", "intel", "what's in this repo", "scan the project".
---

# swt-map

Brownfield-only. Generates the context SWT uses to plan and verify against an existing codebase.

## When to use

- The repo has source files but no `.swt-planning/codebase/` directory yet.
- The user types something like "map the codebase", "swt map", or "scan the project".
- Triggered automatically by `swt init` when the repo is detected as brownfield.

## What this skill does

1. Detects the tech stack and project type by walking the file tree.
2. Spawns the Scout to write four artefacts:
   - `STACK.md` — runtimes, languages, frameworks, package managers
   - `ARCHITECTURE.md` — module boundaries, entry points, important data flows
   - `PATTERNS.md` — coding conventions, naming, file layout
   - `CONCERNS.md` — auth, persistence, observability, errors
3. Writes a `META.md` summary so other skills know the map exists and is fresh.
4. Subsequent skills (`swt-plan`, `swt-qa`, `swt-init` re-runs) will read these files instead of re-scanning the codebase.
