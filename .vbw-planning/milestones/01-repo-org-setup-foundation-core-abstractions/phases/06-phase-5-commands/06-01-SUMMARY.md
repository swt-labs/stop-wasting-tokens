---
phase: 06
plan: 01
title: Commands — argv parser, router, real cmds + 24 stubs (artifact Phase 5)
status: complete
completed: 2026-05-06
tasks_completed: 8
tasks_total: 8
ac_results:
  - id: AC1
    must_have: argv parser using node:util parseArgs (no extra dependency)
    status: pass
    evidence: argv.ts parseSwtArgv wraps node:util parseArgs. Strict mode rejects unknown flags. Global flags handled — --help/-h, --version/-v, --effort, --skip-qa, --skip-audit, --yolo, --plan.
  - id: AC2
    must_have: command router that dispatches to per-command handlers and prints help on unknown verbs
    status: pass
    evidence: router.ts CommandRegistry.register/get/list and dispatch(registry, parsed, io). Unknown verb writes "swt: unknown command" to stderr and points to `swt help`, returns USAGE_ERROR. Duplicate registration throws.
  - id: AC3
    must_have: real implementations for swt help, version, config, status, doctor
    status: pass
    evidence: help.ts renders the registry. version.ts prints `swt <version>`. config.ts implements show/get/set against .swt-planning/config.json with parseConfig from core. status.ts reads .swt-planning/STATE.md (graceful warn when absent). doctor.ts buildDoctorReport composes Node version + codex --version + planning-dir check; renderDoctorReport pretty-prints with check/warn marks.
  - id: AC4
    must_have: stub implementations for 24 remaining commands
    status: pass
    evidence: commands/stubs.ts STUB_SPECS lists init, vibe, plan, execute, qa, map, debug, fix, archive, release, resume, pause, audit, assumptions, research, discuss, phase, todo, skills, whats-new, update, uninstall, worktree, lease. Each stub writes a "not yet implemented" message + roadmap pointer to stderr and returns NOT_IMPLEMENTED.
  - id: AC5
    must_have: exit code contract — 0 success, 1 unknown verb / argv error, 2 stub
    status: pass
    evidence: exit-codes.ts EXIT.{SUCCESS=0, USAGE_ERROR=1, NOT_IMPLEMENTED=2}. Used everywhere instead of magic numbers.
  - id: AC6
    must_have: Vitest tests for argv parsing, router behaviour, real command output
    status: pass
    evidence: argv.test.ts (verb + positionals + flags + unknown flag rejection), router.test.ts (dispatch + unknown verb + missing verb + duplicate registration), help.test.ts (every command + every global flag), version.test.ts (output format), doctor.test.ts (healthy + degraded reports via injected deps), status.test.ts (with and without STATE.md on a temp cwd).
commit_hashes:
  - 16de437
files_modified:
  - packages/cli/src/index.ts
  - packages/cli/src/main.ts
  - packages/cli/src/argv.ts
  - packages/cli/src/router.ts
  - packages/cli/src/help.ts
  - packages/cli/src/exit-codes.ts
  - packages/cli/src/commands/version.ts
  - packages/cli/src/commands/config.ts
  - packages/cli/src/commands/status.ts
  - packages/cli/src/commands/doctor.ts
  - packages/cli/src/commands/stubs.ts
  - packages/cli/test/argv.test.ts
  - packages/cli/test/router.test.ts
  - packages/cli/test/help.test.ts
  - packages/cli/test/version.test.ts
  - packages/cli/test/doctor.test.ts
  - packages/cli/test/status.test.ts
  - packages/cli/test/_helpers.ts
deviations:
  - id: D1
    type: scope
    description: Real swt vibe / plan / execute / qa / archive / audit / phase / todo / discuss / assumptions / research / map / debug / fix / resume / pause / worktree / lease implementations were not built — they remain stubs in this phase.
    resolution: Each stub's roadmap pointer maps it to its real implementation phase. Methodology runtime ships in Phase 7 (Artifacts engine) and Phase 8 (Verification & QA). Distribution-related commands (release, update, uninstall) ship in Phase 10. Skills search ships in Phase 9.
  - id: D2
    type: process
    description: pnpm not installed locally; tests not run in this session.
    resolution: GitHub Actions CI matrix validates on push/PR.
deferred_to_user: []
---

# Phase 6 Summary: Commands

## What Was Built

A working `swt` command surface:

- **Argv parser** (`parseSwtArgv`) using `node:util` `parseArgs` — no extra dependency, strict mode, full SWT global flag set.
- **Command registry + dispatcher** with explicit duplicate detection and a clean unknown-verb path.
- **Five real commands**: `help` (lists everything + global flags), `version` (prints `swt <ver>`), `config` (show/get/set against `.swt-planning/config.json` with full Zod validation via core's `parseConfig`), `status` (reads `STATE.md` and warns gracefully when absent), `doctor` (composable Node + codex + planning-dir health report).
- **24 stub commands** for the rest of the verb surface — each returns exit code 2 and prints a roadmap pointer so users know where the real implementation will land.
- **Six Vitest suites** covering the argv parser, the router (including duplicate registration and unknown verbs), help text completeness, version output, doctor reports under healthy and degraded conditions, and status against a temp directory.

The CLI is now a real published-package entrypoint — `tsup` bundles `packages/cli/src/index.ts` to `dist/cli.{mjs,cjs}` per Phase 2's build config, and `package.json` `bin.swt` points at it.

## Files Modified

See `files_modified` in frontmatter (18 files; 1 deletion of the placeholder smoke test from Phase 2).

## Acceptance criteria status

All 6 must-haves pass. Two deviations recorded — 18 commands intentionally stubbed (D1) and the local pnpm smoke run not performed (D2).

## Commit

`16de437` — feat(cli): argv parser, command router, real cmds + 24 stubs
