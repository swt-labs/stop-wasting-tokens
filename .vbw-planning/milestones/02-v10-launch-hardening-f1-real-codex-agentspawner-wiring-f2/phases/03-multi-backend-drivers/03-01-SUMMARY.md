---
phase: 03
plan: 03-01
title: ClaudeCodeAgentSpawner — claude CLI shell-out + stream-json parser
status: complete
completed: 2026-05-07
tasks_completed: 5
tasks_total: 5
commit_hashes:
  - 8843ebf
  - 8c7e90f
deviations:
  - "Plan 03-01 originally listed only the new files in files_modified. During execution the v1.0 stale `packages/claude-code-driver/test/stub.test.ts` (which asserted the v1.0 STATUS='stub' marker + NotImplementedError throws) needed deletion because the stub it tested no longer exists. Plan-amendment: amended files_modified to include stub.test.ts before deletion. Same audit-trail-preserving pattern as Phase 02 DEV-1A."
  - "Pre-existing v1.0 strict-typecheck pattern surfaced again: spawn/wrapper.ts's `execa(bin, argv, {env: flags.env, ...})` triggers the same exactOptionalPropertyTypes error as packages/codex-driver/src/spawn/wrapper.ts:39 (DEV-1A from Phase 02 R01). Fixed inline this time using the spread-with-conditional pattern (`...(flags.env !== undefined ? { env: flags.env } : {})`) so the new file is typecheck-clean. The codex-driver wrapper's same-class fix is still tracked as a v1.5 follow-up."
pre_existing_issues: []
ac_results:
  - criterion: "@swt-labs/claude-code-driver exports a ClaudeCodeAgentSpawner class implementing the AgentSpawner contract from @swt-labs/core"
    verdict: "pass"
    evidence: "packages/claude-code-driver/src/spawner/claude-code-agent-spawner.ts:38 declares `export class ClaudeCodeAgentSpawner implements AgentSpawner`. AgentSpawner is imported from @swt-labs/core. Barrel re-exports through src/spawner/index.ts and src/index.ts."
  - criterion: "spawn(request) shells out to the `claude` binary via execa with `--print --output-format stream-json` flags, parsing the NDJSON stream into the same SpawnResult shape Codex returns"
    verdict: "pass"
    evidence: "spawn/wrapper.ts composeArgv builds `['--print', '--output-format', 'stream-json', '--model', ..., '--system-prompt', ..., '--session-id', ..., '--add-dir', cwd, prompt]`. wrapper.test.ts case `delegates to spawnClaude via the configured bin` asserts `--print --output-format stream-json` flags appear in the execa call."
  - criterion: "installAgent(spec) writes a deterministic agent profile to ${CLAUDE_CONFIG_DIR:-~/.claude}/agents/${role}.json using atomic tmp+rename"
    verdict: "pass"
    evidence: "claude-code-agent-spawner.ts:50-66 mkdir agentsDir, tmp filename via randomBytes(8), writeFile then rename. claude-code-agent-spawner.test.ts case `writes the JSON profile to {claude_config_dir}/agents/{role}.json` asserts the file exists with the correct prompt/model/tools/sandbox_mode/max_turns shape."
  - criterion: "removeAgent(role) unlinks the agent profile file; idempotent (no-op if missing)"
    verdict: "pass"
    evidence: "claude-code-agent-spawner.ts:78-89 try unlink; catch ENOENT and swallow. spawner.test.ts cases `unlinks the JSON profile` and `is a no-op when the profile is missing` cover both branches."
  - criterion: "the class is constructable without arguments and uses sensible defaults for claude_config_dir + bin path"
    verdict: "pass"
    evidence: "claude-code-agent-spawner.ts:42-51 constructor opts = {} default; claude_config_dir defaults to process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'); bin defaults to 'claude'."
  - criterion: "spawnClaude exposes the same SpawnFlags surface (profile/bin/env) as spawnCodex so the dispatch layer in Plan 03-05 can treat both spawners interchangeably"
    verdict: "pass"
    evidence: "wrapper.ts SpawnFlags interface has bin/env (parallel to Codex's SpawnFlags). SpawnFlags also adds Claude-specific flags (bare, allowed_tools) that don't conflict with the cross-driver dispatch contract."
---

Replaced the v1.0 NotImplementedError stub in `@swt-labs/claude-code-driver` with a working AgentSpawner implementation. Same NDJSON-handoff contract as Phase 02's CodexAgentSpawner — the dispatch layer in Plan 03-05 can swap between Codex and Claude Code without methodology code changes.

## What Was Built

- **`packages/claude-code-driver/tsconfig.json`** — fixes pre-existing v1.0 gap (package had no tsconfig; typecheck was failing with TS5083). Mirrors codex-driver's pattern.
- **`packages/claude-code-driver/package.json`** — adds `execa@^9.5.1` + `zod@^3.23.8` runtime deps.
- **`packages/claude-code-driver/src/spawn/parser.ts`** — `parseLine` + `parseStream` recognising 4 envelope shapes: assistant text chunks (`{type:"assistant", message:{content:[{type:"text", text}]}}`), bare text chunks for compat, structured handoff envelopes (HandoffEnvelopeSchema-validated), usage chunks (`{type:"result", usage:{input_tokens, output_tokens}}`).
- **`packages/claude-code-driver/src/spawn/wrapper.ts`** — `spawnClaude(request, flags)` low-level function. Composes argv as `claude --print --output-format stream-json [--model] [--system-prompt] --session-id <uuid> --add-dir <cwd> [--allowed-tools] [--bare] <prompt>`. Aggregates parsed lines into SpawnResult with last-write-wins usage semantics (parallel to Phase 02's wrapper).
- **`packages/claude-code-driver/src/spawner/claude-code-agent-spawner.ts`** — `class ClaudeCodeAgentSpawner implements AgentSpawner`. installAgent writes JSON profile via atomic tmp+rename; spawn delegates to spawnClaude; removeAgent unlinks idempotently. Constructor defaults: `claude_config_dir = process.env.CLAUDE_CONFIG_DIR ?? ~/.claude`, `bin = 'claude'`.
- **`packages/claude-code-driver/src/index.ts`** — drops the v1.0 stub class + STATUS='stub' marker; barrel exports spawn + spawner modules.
- **Two NDJSON fixtures** for parser/wrapper tests: `claude-stream-text.ndjson` (3 assistant text chunks + final result usage) and `claude-stream-with-handoff.ndjson` (text + scout-findings envelope + result usage).
- **13 new test cases**: 5 parser + 3 wrapper (mocked execa) + 5 spawner (real fs against tmp claude_config_dir).
- **Removes `test/stub.test.ts`** which asserted the v1.0 stub state — stale now that the real class shipped.

## Files Modified

- `packages/claude-code-driver/tsconfig.json` (new)
- `packages/claude-code-driver/package.json` (deps)
- `packages/claude-code-driver/src/index.ts` (replaced stub)
- `packages/claude-code-driver/src/spawn/parser.ts` (new)
- `packages/claude-code-driver/src/spawn/wrapper.ts` (new)
- `packages/claude-code-driver/src/spawn/index.ts` (new barrel)
- `packages/claude-code-driver/src/spawner/claude-code-agent-spawner.ts` (new)
- `packages/claude-code-driver/src/spawner/index.ts` (new barrel)
- `packages/claude-code-driver/test/parser.test.ts` (new — 5 cases)
- `packages/claude-code-driver/test/wrapper.test.ts` (new — 3 cases)
- `packages/claude-code-driver/test/spawner/claude-code-agent-spawner.test.ts` (new — 5 cases)
- `packages/claude-code-driver/test/fixtures/claude-stream-text.ndjson` (new)
- `packages/claude-code-driver/test/fixtures/claude-stream-with-handoff.ndjson` (new)
- `packages/claude-code-driver/test/stub.test.ts` (DELETED — was testing v1.0 stub state)

## Deviations

See frontmatter `deviations:`. Two:

1. **Stale `stub.test.ts` deletion (plan-amendment)** — the v1.0 test file asserting STATUS='stub' + NotImplementedError throws had to be deleted because the stub it tested no longer exists. Plan files_modified amended to include the file before deletion.
2. **Pre-existing typecheck pattern fixed inline (process-exception → handled)** — same `execa env` exactOptionalPropertyTypes error that Phase 02 carried as DEV-1A. This time fixed inline in spawn/wrapper.ts using the spread-with-conditional pattern. The codex-driver original gap is still tracked as a v1.5 follow-up.

## Verification

1. ✅ `pnpm --filter @swt-labs/claude-code-driver typecheck` exits 0 — clean (no errors)
2. ✅ `pnpm vitest run packages/claude-code-driver` — 13/13 pass (5 parser + 3 wrapper + 5 spawner)
3. ✅ `import { ClaudeCodeAgentSpawner } from '@swt-labs/claude-code-driver'` works without NotImplementedError
4. ✅ The spawn surface (`spawnClaude(request, flags)`) is interchangeable with `spawnCodex` — same SpawnRequest input + SpawnResult output shape; Plan 03-05's dispatch layer can swap between them
5. ⚠ Validation against a real `claude --print --output-format stream-json` run is deferred to a v1.5 follow-up (same pattern as Phase 02's DEV-2A NDJSON fixture deviation — no live binary in this environment to capture an actual stream sample). The fixture schemas align with documented Claude Code output and the `--include-hook-events` flag surface verified via `claude --help`.

## Next

Plan 03-02 (ClaudeCodeHookHost — 12-event taxonomy → SWT's 6 generic events) lifts directly off this plan's parser foundation. Plan 03-03 (OllamaAgentSpawner) is independent and can run in parallel.
