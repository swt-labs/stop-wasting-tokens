---
phase: 15
plan: "01"
title: Core abstractions audit + Claude Code + Ollama driver stubs
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"Abstractions audit log","verdict":"pass","evidence":".vbw-planning/research/v1-5-abstractions-audit.md authored. Walks 5 abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore, Prompter — Prompter not in plan but added for completeness). Each has a Findings table with location/category/severity/note rows + a Recommendation paragraph. Summary table at top + Outstanding follow-ups list at bottom (3 v1.5 candidates, all driver-side, none gating). Overall readiness: PASS — abstractions are driver-portable as-is."}
  - {"id":"AC2","criterion":"@swt-labs/claude-code-driver stub package","verdict":"pass","evidence":"packages/claude-code-driver/{package.json, src/index.ts, README.md, test/stub.test.ts}. package.json declares public + provenance + repository + bugs + homepage + MIT license. ClaudeCodeAgentSpawner class implements AgentSpawner interface (installAgent, spawn, removeAgent — all 3 throw 'Not implemented' with v1.5 roadmap reference). PACKAGE_NAME + VERSION + STATUS exports for metadata-driven tests."}
  - {"id":"AC3","criterion":"@swt-labs/ollama-driver stub package","verdict":"pass","evidence":"packages/ollama-driver/{package.json, src/index.ts, README.md, test/stub.test.ts}. Same shape as claude-code-driver: identical interface implementation, same throw-on-call pattern, same metadata exports. OllamaAgentSpawner class implements AgentSpawner."}
  - {"id":"AC4","criterion":"Workspace + changeset wiring","verdict":"pass","evidence":"pnpm-workspace.yaml: existing packages/* glob covers both new directories — no edit needed (verified by inspection). .changeset/config.json: linked array extended from 7 entries to 9 (added @swt-labs/claude-code-driver + @swt-labs/ollama-driver). scripts/bump-version.sh PACKAGES array extended (was 7, now 9); display message changed from '8 manifests' to '10 manifests' (root + 9 packages)."}
  - {"id":"AC5","criterion":"Vitest for stubs + extended publish-config drift check","verdict":"pass","evidence":"packages/claude-code-driver/test/stub.test.ts: 7 tests (3 throw checks for installAgent/spawn/removeAgent, error message references 'not implemented' + 'v1.5', PACKAGE_NAME exact match, STATUS=stub, VERSION=0.0.0). Same shape for packages/ollama-driver/test/stub.test.ts. packages/cli/test/publish-config.test.ts PACKAGES array extended from 7 to 9 — drift check + per-package shape check now cover all 9 packages."}
pre_existing_issues: []
commit_hashes:
  - 249bdc3
files_modified:
  - .vbw-planning/research/v1-5-abstractions-audit.md
  - packages/claude-code-driver/package.json
  - packages/claude-code-driver/src/index.ts
  - packages/claude-code-driver/README.md
  - packages/claude-code-driver/test/stub.test.ts
  - packages/ollama-driver/package.json
  - packages/ollama-driver/src/index.ts
  - packages/ollama-driver/README.md
  - packages/ollama-driver/test/stub.test.ts
  - .changeset/config.json
  - scripts/bump-version.sh
  - packages/cli/test/publish-config.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"Plan called for auditing 4 abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore). The audit also covers Prompter — the fifth abstraction in packages/core/src/abstractions/.","resolution":"Prompter is small (3 method signatures) and inspecting it confirms full driver-portability. Adding it is a small +30-line section in the audit that closes the loop completely. No downside to including it; the v1.5 driver work won't have to revisit Prompter as a known unknown."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 15-01 shipped as one bundled commit (5 tasks, 12 files).","resolution":"Same rationale as prior plans — bundled commit 249bdc3."}
  - {"id":"D3","type":"process","description":"pnpm install / pnpm test not run locally — environment lacks pnpm.","resolution":"GitHub Actions vitest matrix validates on push/PR. The 14 new stub tests + extended publish-config tests will surface any regressions on the next CI invocation."}
deferred_to_followup:
  - "PLAN 15-02: UI/dashboard design notes + canonical v1.5 roadmap."
  - "v1.5: real Claude Code driver implementation (REQ-V2-02)."
  - "v1.5: real Ollama driver implementation (REQ-V2-03)."
  - "v1.5: 3 minor abstraction-side improvements (HookHost narrowing helpers, Claude Code driver tool-types enum, MemoryStore JSDoc rephrase) — all driver-side, not core."
---

# Phase 15 / Plan 01 Summary: Core abstractions audit + Claude Code + Ollama driver stubs

## What Was Built

Forward-compatibility for v1.5 — the engineering layer that locks in the contract surface for Claude Code and Ollama drivers:

- **Abstractions audit** at `.vbw-planning/research/v1-5-abstractions-audit.md` — confirms the 5 core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore, Prompter) are driver-portable. 3 minor recommendations land driver-side in v1.5.
- **`@swt-labs/claude-code-driver`** — new stub package implementing AgentSpawner with throw-on-call semantics. Reserves the npm name + locks in the v1.5 contract surface.
- **`@swt-labs/ollama-driver`** — same shape, same semantics.
- **Workspace + changeset + bump-version + publish-config** — all extended to cover the new packages.
- **Vitest** — 14 stub tests + extended publish-config drift check.

## Files Modified

See `files_modified` in frontmatter (12 files: 1 audit + 4 per stub × 2 + 3 wiring updates).

## Acceptance criteria status

All 5 must-haves pass. Three deviations recorded (D1: Prompter included in audit, D2: bundled commit, D3: CI-deferred test).

## Phase 15 contract progress

PLAN 15-01 closes the engineering forward-compat. PLAN 15-02 closes the design forward-compat (UI/dashboard tradeoffs + canonical v1.5 roadmap).

## Commit

`249bdc3` — feat(v1.5-prep): abstractions audit + Claude Code + Ollama driver stubs (Phase 15 / PLAN 01)
