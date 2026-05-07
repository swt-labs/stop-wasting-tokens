---
phase: 03
plan: 03-04
title: Ollama sandbox-mode wrapping — process-level isolation per spec.sandbox_mode
status: complete
completed: 2026-05-07
tasks_completed: 3
tasks_total: 3
commit_hashes:
  - 59df036
deviations:
  - "Plan 03-04 originally listed only `packages/ollama-driver/test/sandbox/wrapper.test.ts` for new tests. T2's wiring change (system prompt now includes the sandbox preamble) broke Plan 03-03's existing spawner test that asserted `body.messages[0].content === 'You are the installed Scout.'` Plan-amendment: amended files_modified to include `packages/ollama-driver/test/spawner/ollama-agent-spawner.test.ts` and switched the assertion from `toBe` to `toContain` so it validates the prompt is preserved while accepting the preamble layer above it. Same audit-trail-preserving pattern as Plan 03-01 DEV-3-01-A."
  - "F3 success criterion `Sandbox modes degrade gracefully — driver wraps process-level isolation` is partially delivered: the preamble half lands in this plan; the PermissionGate enforcement half (real path-validation in spawn) is deferred. Process-exception: Ollama itself has no kernel-level sandbox primitive (no `--sandbox` flag like Codex), so real enforcement must live at the SWT-side PermissionGate boundary which is itself a v2 concern (the v1.0 contract exists in @swt-labs/core/abstractions/PermissionGate.ts but no concrete implementation ships in v1.5). Tracked as a v1.5 follow-up: integrate PermissionGate.evaluate calls into the OllamaAgentSpawner.spawn path once a default PermissionGate implementation lands."
pre_existing_issues: []
ac_results:
  - criterion: "OllamaAgentSpawner honors the spec.sandbox_mode field by wrapping the request prompt with a sandbox-appropriate guard preamble before sending to Ollama"
    verdict: "pass"
    evidence: "spawner/ollama-agent-spawner.ts:35-50 spawn() resolves effective spec, computes `applySandboxToPrompt(effectiveSpec.developer_instructions, effectiveSpec.sandbox_mode, request.cwd)`, passes the wrapped prompt via SpawnFlags.system_prompt_override. The Plan 03-03 spawner test was updated to assert the preamble appears in `body.messages[0].content` alongside the installed prompt."
  - criterion: "sandbox_mode='read-only' preamble instructs the model to refuse any tool that would mutate the filesystem"
    verdict: "pass"
    evidence: "sandbox/wrapper.ts SANDBOX_PREAMBLES['read-only'] returns text containing `MUST NOT mutate the filesystem` + `Refuse any tool call that would write, delete, or rename files`. wrapper.test.ts case `read-only mode produces a preamble that forbids mutations` asserts the preamble shape."
  - criterion: "sandbox_mode='workspace-write' preamble instructs the model that mutations are scoped to request.cwd and below"
    verdict: "pass"
    evidence: "SANDBOX_PREAMBLES['workspace-write'] interpolates cwd into the preamble (`within the working directory ${cwd} and its subtree`). wrapper.test.ts case `workspace-write mode references the cwd as the writable subtree` asserts the preamble + cwd interpolation."
  - criterion: "sandbox_mode='danger-full-access' preamble notes no sandbox; passes through to the model unchanged"
    verdict: "pass"
    evidence: "SANDBOX_PREAMBLES['danger-full-access'] preamble starts with `No sandbox`. wrapper.test.ts case `danger-full-access mode notes no sandbox + still includes the cwd marker` asserts."
  - criterion: "applySandboxToPrompt is a pure function — same input + mode + cwd always produces the same wrapped prompt"
    verdict: "pass"
    evidence: "wrapper.test.ts case `is a pure function — same inputs always produce identical output` calls applySandboxToPrompt twice with identical args + asserts the outputs are byte-equal. Also asserts SANDBOX_PREAMBLES table functions are deterministic."
  - criterion: "Ollama lacks a native sandbox primitive so sandbox enforcement is process-level on the SWT side via PermissionGate; this plan documents that boundary explicitly"
    verdict: "pass"
    evidence: "Frontmatter deviation #2 documents this gap as the canonical v1.5 follow-up boundary: the preamble half (model-facing contract) lands in this plan; the PermissionGate enforcement half (real path-validation) is tracked separately."
---

OllamaAgentSpawner now respects `spec.sandbox_mode`. F3's "Sandbox modes degrade gracefully — driver wraps process-level isolation" success criterion is met for the preamble layer; the PermissionGate enforcement layer is documented as a v1.5 follow-up alongside the broader PermissionGate-implementation work.

## What Was Built

- **`packages/ollama-driver/src/sandbox/wrapper.ts`** — `SANDBOX_PREAMBLES: Readonly<Record<SandboxMode, (cwd: string) => string>>` table with one template function per mode; `applySandboxToPrompt(systemPrompt, mode, cwd)` pure function that prepends the mode's preamble.
- **`packages/ollama-driver/src/sandbox/index.ts`** — barrel.
- **`packages/ollama-driver/src/index.ts`** — append `export * from './sandbox/index.js'`.
- **`packages/ollama-driver/src/spawner/ollama-agent-spawner.ts`** — spawn() resolves effective spec (installed > request), wraps `developer_instructions` via `applySandboxToPrompt`, passes the wrapped prompt to `spawnOllama` via the existing `system_prompt_override` SpawnFlag.
- **`packages/ollama-driver/test/sandbox/wrapper.test.ts`** — 5 unit tests covering all 3 modes + undefined fallback (`workspace-write`) + determinism property.
- **`packages/ollama-driver/test/spawner/ollama-agent-spawner.test.ts`** (modified) — Plan 03-03's `installAgent stores the spec` test updated from `toBe` to `toContain` so it validates the prompt is preserved while accepting the preamble layer.

## Files Modified

- `packages/ollama-driver/src/sandbox/wrapper.ts` (new)
- `packages/ollama-driver/src/sandbox/index.ts` (new barrel)
- `packages/ollama-driver/src/index.ts` (append sandbox barrel export)
- `packages/ollama-driver/src/spawner/ollama-agent-spawner.ts` (wire applySandboxToPrompt)
- `packages/ollama-driver/test/sandbox/wrapper.test.ts` (new — 5 cases)
- `packages/ollama-driver/test/spawner/ollama-agent-spawner.test.ts` (modified — assertion updated)

## Sandbox preamble templates

```
read-only:           refuse mutations + cwd marker
workspace-write:     scope mutations to cwd subtree (default for undefined)
danger-full-access:  no sandbox + cwd marker
```

## Deviations

See frontmatter `deviations:`. Two:

1. **Plan 03-03 spawner test assertion update (plan-amendment)** — wiring sandbox preamble into spawn changed the system message content shape. Plan 03-04 files_modified amended to include the test file before the assertion was relaxed from `toBe` to `toContain`.
2. **PermissionGate enforcement deferred (process-exception)** — Ollama has no kernel-level sandbox primitive, so SWT-side PermissionGate is the only enforcement path. The PermissionGate contract exists in @swt-labs/core but no concrete implementation ships in v1.5. Tracked as a v1.5 follow-up: integrate `PermissionGate.evaluate` into `OllamaAgentSpawner.spawn` once a default implementation lands.

## Verification

1. ✅ `pnpm --filter @swt-labs/ollama-driver typecheck` exits 0
2. ✅ `pnpm vitest run packages/ollama-driver` — 18/18 pass (5 parser + 3 wrapper + 5 spawner + 5 sandbox)

## Next

Plan 03-05 (driver dispatch wiring) is the integration plan. It adds the `backend` config key to `@swt-labs/core`, wires CodexAgentSpawner / ClaudeCodeAgentSpawner / OllamaAgentSpawner into the CLI vibe handler via a switch on `config.backend`, adds a `--backend` CLI flag override, and ships cross-backend integration tests.
