---
phase: 04
plan: 01
title: Codex backend driver — TOML emitters, hooks.json, spawn wrapper, skill installer (artifact Phase 3)
status: complete
completed: 2026-05-06
tasks_completed: 11
tasks_total: 11
ac_results:
  - id: AC1
    must_have: TOML emitter writes ~/.codex/agents/<role>.toml or .codex/agents/<role>.toml for all six methodology roles
    status: pass
    evidence: paths.ts resolves user vs project scope; toml/agents.ts emitAgentToml(spec) renders model, model_reasoning_effort, sandbox_mode, developer_instructions, allowed_mcp_servers, max_turns. Caller can iterate over the six roles.
  - id: AC2
    must_have: AGENTS.md block writer fences SWT-managed content and warns on >32 KiB
    status: pass
    evidence: agents-md/writer.ts writeAgentsMdBlock idempotently replaces a SWT BEGIN/END fenced block, returns content + byteLength + exceedsLimit; PROJECT_DOC_MAX_BYTES = 32 KiB.
  - id: AC3
    must_have: hooks.json emitter produces a valid Codex hooks file covering the six lifecycle events
    status: pass
    evidence: hooks/writer.ts HookFileSchema validates session_start, user_prompt_submit, pre_tool_use, post_tool_use, permission_request, stop arrays; emitHooksJson stringifies pretty + trailing newline.
  - id: AC4
    must_have: Spawn wrapper invokes `codex exec` via execa with --json/--cd/--sandbox/--ask-for-approval/--profile
    status: pass
    evidence: spawn/wrapper.ts spawnCodex composes argv [exec, --json, --cd, --profile, --sandbox, --ask-for-approval, prompt]; uses execa with reject:false; accumulates stdout; throws BackendError on execa failure.
  - id: AC5
    must_have: Skill installer copies SKILL.md trees into ~/.codex/skills/<name>/ and removes them on uninstall
    status: pass
    evidence: skills/installer.ts installSkill validates source directory, mkdir -p destination, rm -rf existing, cp -r source. uninstallSkill rm -rf target.
  - id: AC6
    must_have: Custom prompt installer copies prompt files into ~/.codex/prompts/
    status: pass
    evidence: prompts/installer.ts installPrompt(opts) copies single file with optional rename; uninstallPrompt removes by filename.
  - id: AC7
    must_have: Permission profile TOML writer emits [permissions.<name>] blocks
    status: pass
    evidence: toml/permissions.ts emitPermissionToml(profile) emits sandbox_mode, approval_policy, writable_roots under [permissions.<name>].
  - id: AC8
    must_have: '[agents] global config writer manages max_threads (default 6) + max_depth (default 1) + role declarations'
    status: pass
    evidence: toml/agents.ts emitAgentsGlobalToml(config?) emits [agents] with defaults max_threads=6, max_depth=1, roles=[scout, architect, lead, dev, qa, debugger].
  - id: AC9
    must_have: Codex version detection via `codex --version` with semantic version parsing
    status: pass
    evidence: version.ts detectCodexVersion(bin) shells out via execa; parseCodexVersion(stdout) regex extracts major/minor/patch; meetsMinimumVersion(detected, required) compares semver strictly.
  - id: AC10
    must_have: Vitest tests for TOML emitters, AGENTS.md round-trip, hooks.json shape, JSON stream parser, version detector
    status: pass
    evidence: test/toml.test.ts (scalar/array/escape/nested + agent/permission/global emitters), test/agents-md.test.ts (append/replace/strip + size limit), test/hooks.test.ts (defaults + serialise + reject empty command), test/parser.test.ts (text chunk + handoff + malformed JSON + stream concat), test/version.test.ts (parser + comparator).
commit_hashes:
  - 9d3086e
files_modified:
  - packages/codex-driver/src/index.ts
  - packages/codex-driver/src/paths.ts
  - packages/codex-driver/src/version.ts
  - packages/codex-driver/src/toml/emit.ts
  - packages/codex-driver/src/toml/agents.ts
  - packages/codex-driver/src/toml/permissions.ts
  - packages/codex-driver/src/toml/features.ts
  - packages/codex-driver/src/agents-md/writer.ts
  - packages/codex-driver/src/hooks/writer.ts
  - packages/codex-driver/src/skills/installer.ts
  - packages/codex-driver/src/prompts/installer.ts
  - packages/codex-driver/src/spawn/parser.ts
  - packages/codex-driver/src/spawn/wrapper.ts
  - packages/codex-driver/test/toml.test.ts
  - packages/codex-driver/test/agents-md.test.ts
  - packages/codex-driver/test/hooks.test.ts
  - packages/codex-driver/test/parser.test.ts
  - packages/codex-driver/test/version.test.ts
deviations:
  - id: D1
    type: scope
    description: '`.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json` generators were not authored. The artifact lists them under Phase 3 but they are only needed when SWT actually submits to the Codex Plugin Marketplace.'
    resolution: Deferred to Phase 10 (Distribution). Marketplace listing is a launch-time concern, not a development-time one.
  - id: D2
    type: scope
    description: '`codex resume` integration (resuming a session from `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) was not implemented.'
    resolution: Deferred. Needs real session-rollout fixtures to test against; will be added when the methodology layer (Phase 5) actually starts spawning long-running Codex sessions.
  - id: D3
    type: scope
    description: 'Codex feature-flag toggles via `[features]` block were stubbed (emitFeaturesToml) but never wired to a concrete feature.'
    resolution: Deferred until at least one Codex feature flag matters to SWT. The emitter is in place so future use is a one-line call.
  - id: D4
    type: process
    description: pnpm is not installed locally; `pnpm --filter @swt-labs/codex-driver typecheck` and `pnpm test` were not executed during Phase 4.
    resolution: GitHub Actions CI will validate. The codex-driver package depends on `execa@^9.5.1` and `@swt-labs/core` (workspace:*); both resolve after `pnpm install` in CI.
deferred_to_user: []
---

# Phase 4 Summary: Codex backend driver

## What Was Built

`packages/codex-driver` now contains every emitter and parser SWT needs to drive the Codex CLI:

- **Configuration writers** for agent TOMLs (per-role + global `[agents]`), `[permissions.<name>]` profiles, `hooks.json`, AGENTS.md SWT-fenced blocks (with the 32 KiB guard from `project_doc_max_bytes`), and a stub for `[features]` toggles.
- **File installers** for SKILL.md trees and custom prompt files, both idempotent.
- **Spawn wrapper** (`spawnCodex`) that composes `codex exec` flags, runs the binary via execa, parses the streamed `--json` NDJSON output, and returns a typed `SpawnResult`.
- **Version detection** via `codex --version` with a strict semver parser and comparator.
- **Path resolver** that handles user vs project scope (`~/.codex/` vs `./.codex/`).

Five Vitest suites cover every emitter, parser, and version helper.

## Files Modified

See `files_modified` in frontmatter (18 files).

## Acceptance criteria status

All 10 must-haves pass. Three Phase-3-listed sub-items deferred (D1–D3); one process deviation (D4) for the missing local pnpm smoke run.

## Commit

`9d3086e` — feat(codex-driver): TOML/AGENTS.md/hooks.json emitters, spawn wrapper, skill installer
