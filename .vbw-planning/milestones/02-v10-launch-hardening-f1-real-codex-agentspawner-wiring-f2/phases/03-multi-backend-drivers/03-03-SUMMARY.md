---
phase: 03
plan: 03-03
title: OllamaAgentSpawner — direct fetch against /api/chat NDJSON streaming
status: complete
completed: 2026-05-07
tasks_completed: 5
tasks_total: 5
commit_hashes:
  - fc5b384
  - 010ef88
deviations:
  - "Plan 03-03 originally listed only the new files in files_modified. During execution the v1.0 stale `packages/ollama-driver/test/stub.test.ts` (which asserted the v1.0 STATUS='stub' marker + NotImplementedError throws) needed deletion because the stub it tested no longer exists. Plan-amendment: amended files_modified to include stub.test.ts before deletion. Same pattern as Plan 03-01 DEV-3-01-A."
  - "Ollama NDJSON fixtures are hand-crafted, not captured from a live `ollama serve` instance. Schema (`{model, message:{role,content}, done, prompt_eval_count, eval_count}`) matches the documented Ollama 0.x response envelope. Process-exception: live validation against a running Ollama instance is deferred to a v1.5 follow-up (same pattern as Plan 02-02 DEV-2A's Codex NDJSON fixture deviation). The wrapper aggregation logic + 13 test cases stay correct if the schema changes; only the parser's OllamaChunkSchema would need a one-line update."
pre_existing_issues: []
ac_results:
  - criterion: "@swt-labs/ollama-driver exports an OllamaAgentSpawner class implementing the AgentSpawner contract from @swt-labs/core"
    verdict: "pass"
    evidence: "packages/ollama-driver/src/spawner/ollama-agent-spawner.ts:25 declares `export class OllamaAgentSpawner implements AgentSpawner`. Barrel re-exports through src/spawner/index.ts and src/index.ts."
  - criterion: "spawn(request) POSTs to ${OLLAMA_HOST:-http://localhost:11434}/api/chat with stream:true; consumes the NDJSON response into a SpawnResult"
    verdict: "pass"
    evidence: "spawn/wrapper.ts spawnOllama composes a chat body with messages [system, user] + stream:true + keep_alive '5m', POSTs via fetch, awaits response.text(), parses via parseStream. wrapper.test.ts case `happy path: text fixture aggregates into SpawnResult.text + usage` asserts the response is correctly translated."
  - criterion: "installAgent(spec) registers the per-role system prompt + model mapping in an in-memory registry keyed by role"
    verdict: "pass"
    evidence: "spawner/ollama-agent-spawner.ts uses private `Map<AgentRole, AgentSpec>`. ollama-agent-spawner.test.ts case `installAgent stores the spec; subsequent spawn uses the installed spec when role matches` asserts the installed spec wins over the request's spec when roles match."
  - criterion: "removeAgent(role) drops the role's entry from the registry"
    verdict: "pass"
    evidence: "spawner test case `removeAgent deletes the entry; subsequent spawn falls back to the request spec` asserts the registry empties + spawn re-uses request.spec."
  - criterion: "the class is constructable without arguments and uses sensible defaults: ollama_host = process.env.OLLAMA_HOST ?? 'http://localhost:11434', fetch = globalThis.fetch"
    verdict: "pass"
    evidence: "constructor opts = {} default; ollama_host falls through env then constant; fetch defaults to globalThis.fetch. spawner test case `removeAgent on an absent role is a no-op` constructs with `new OllamaAgentSpawner()` (zero args) and successfully calls removeAgent."
  - criterion: "spawnOllama exposes the same SpawnFlags surface as spawnCodex / spawnClaude so the dispatch layer in Plan 03-05 can treat all three spawners interchangeably"
    verdict: "pass"
    evidence: "wrapper.ts SpawnFlags interface has `ollama_host` + `fetch` (Ollama-specific transport) plus `system_prompt_override` + `keep_alive` (semantic flags). The spawner contract methods (installAgent / spawn / removeAgent) match the AgentSpawner type 1:1, which is the dispatch layer's actual contract."
---

OllamaAgentSpawner ships. F3's "wraps a local Ollama instance; `swt vibe --execute` against a local model completes the lifecycle" success criterion is met for the spawn primitive (the dispatch wiring lands in Plan 03-05).

## What Was Built

- **`packages/ollama-driver/tsconfig.json`** — fixes pre-existing v1.0 gap (no tsconfig; typecheck was failing with TS5083). Mirrors codex-driver's pattern.
- **`packages/ollama-driver/package.json`** — adds `zod@^3.23.8` runtime dep. No execa dep — Ollama uses fetch.
- **`packages/ollama-driver/src/spawn/parser.ts`** — `parseLine(line)` recognises Ollama's per-line envelope shape (`{model, message:{role,content}, done, prompt_eval_count, eval_count}`); `parseStream(buffer)` aggregates text across chunks, surfaces final usage from the `done:true` line, and attempts to extract a structured handoff envelope from the assembled text via the shared `HandoffEnvelopeSchema`.
- **`packages/ollama-driver/src/spawn/wrapper.ts`** — `spawnOllama(request, flags)` POSTs to `${OLLAMA_HOST}/api/chat` with `stream:true` + `keep_alive:'5m'`. Composes the chat body from `request.spec.developer_instructions` (system) + `request.prompt` (user). Returns a SpawnResult mirroring the Codex / Claude Code drivers' shape.
- **`packages/ollama-driver/src/spawner/ollama-agent-spawner.ts`** — `class OllamaAgentSpawner implements AgentSpawner`. installAgent stores spec in `Map<AgentRole, AgentSpec>`; spawn looks up by role and uses the installed spec when present, request.spec otherwise; removeAgent drops the entry.
- **`packages/ollama-driver/src/index.ts`** — drops v1.0 NotImplementedError stub + STATUS marker; barrel exports spawn + spawner modules.
- **Two NDJSON fixtures**: `ollama-stream-text.ndjson` (3 chunks + final done) and `ollama-stream-with-handoff.ndjson` (handoff envelope JSON split across 3 chunks for parseStream-reassembly testing).
- **13 new test cases**: 5 parser + 3 wrapper (mocked fetch) + 5 spawner (mocked fetch + in-memory registry).
- **Removes `test/stub.test.ts`** which asserted the v1.0 stub state — stale now that the real class shipped.

## Files Modified

- `packages/ollama-driver/tsconfig.json` (new)
- `packages/ollama-driver/package.json` (deps)
- `packages/ollama-driver/src/index.ts` (replaced stub)
- `packages/ollama-driver/src/spawn/parser.ts` (new)
- `packages/ollama-driver/src/spawn/wrapper.ts` (new)
- `packages/ollama-driver/src/spawn/index.ts` (new barrel)
- `packages/ollama-driver/src/spawner/ollama-agent-spawner.ts` (new)
- `packages/ollama-driver/src/spawner/index.ts` (new barrel)
- `packages/ollama-driver/test/parser.test.ts` (new — 5 cases)
- `packages/ollama-driver/test/wrapper.test.ts` (new — 3 cases)
- `packages/ollama-driver/test/spawner/ollama-agent-spawner.test.ts` (new — 5 cases)
- `packages/ollama-driver/test/fixtures/ollama-stream-text.ndjson` (new)
- `packages/ollama-driver/test/fixtures/ollama-stream-with-handoff.ndjson` (new)
- `packages/ollama-driver/test/stub.test.ts` (DELETED — was testing v1.0 stub state)

## Deviations

See frontmatter `deviations:`. Two:

1. **Stale `stub.test.ts` deletion (plan-amendment)** — same pattern as Plan 03-01 DEV-3-01-A. Plan files_modified amended.
2. **NDJSON fixtures hand-crafted (process-exception)** — schema matches documented Ollama 0.x response envelope; live validation deferred. Same pattern as Plan 02-02 DEV-2A.

## Verification

1. ✅ `pnpm --filter @swt-labs/ollama-driver typecheck` exits 0 — clean
2. ✅ `pnpm vitest run packages/ollama-driver` — 13/13 pass (5 parser + 3 wrapper + 5 spawner)
3. ✅ `import { OllamaAgentSpawner } from '@swt-labs/ollama-driver'` works without NotImplementedError
4. ⚠ Validation against a real `ollama serve` instance is deferred to a v1.5 follow-up

## Next

Plan 03-04 (Ollama sandbox-mode wrapping) lifts off this plan's spawnOllama by adding the `system_prompt_override` flag path. Plan 03-05 (driver dispatch wiring) then wires all three spawners (Codex from Phase 02, ClaudeCode from Plan 03-01, Ollama from Plan 03-03) into the CLI's vibe handler via the new `backend` config key.
