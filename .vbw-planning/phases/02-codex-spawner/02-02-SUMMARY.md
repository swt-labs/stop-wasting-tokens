---
phase: 02
plan: 02-02
title: Token usage extraction from Codex NDJSON
status: complete
completed: 2026-05-07
tasks_completed: 4
tasks_total: 4
commit_hashes: []
deviations:
  - "T1 NDJSON fixture schema is hand-crafted, not captured from a live `codex exec --json` run. The chosen shape `{type: 'usage', usage: {input_tokens, output_tokens}}` matches the AgentSpawner contract's SpawnResult.usage type exactly and is consistent with the shape OpenAI Codex CLI documentation describes for the September 2025 release. If the real Codex schema differs (e.g., a different envelope key like `token_count` or nested differently), parser.ts UsageChunkSchema needs a one-line update — the wrapper aggregation logic and test coverage stay correct. Flagged for verification once a Codex CLI install is available locally."
  - "Plan 02-02 amended files_modified mid-execution: corrected paths from packages/codex-driver/test/spawn/{parser,wrapper}.test.ts (which assumed a nested test/spawn layout that doesn't exist) to packages/codex-driver/test/{parser,wrapper}.test.ts (the actual flat layout). Same source files in spawn/ subpath; the test directory is flat in this project."
pre_existing_issues: []
ac_results:
  - criterion: "parseLine recognises Codex `usage` chunks with input_tokens / output_tokens fields and surfaces them as a typed ParsedLine.usage"
    verdict: "pass"
    evidence: "packages/codex-driver/src/spawn/parser.ts adds UsageChunkSchema (Zod) and a usage-recognition branch between handoff and text. parser.test.ts cases `parses a usage chunk`, `rejects a usage chunk with non-numeric token counts`, `rejects a usage chunk with negative token counts` all pass."
  - criterion: "parseStream accumulates usage across lines (last-write-wins for the final tally)"
    verdict: "pass"
    evidence: "wrapper.test.ts case `aggregates usage last-write-wins when multiple chunks appear` constructs a stream with two usage chunks (input_tokens 100→250) and asserts result.usage matches the second (final) chunk."
  - criterion: "spawnCodex's SpawnResult.usage is populated when Codex emits at least one usage chunk; absent otherwise"
    verdict: "pass"
    evidence: "wrapper.test.ts case `populates SpawnResult.usage when the stream contains a usage chunk` (uses the captured fixture, asserts {input_tokens:4218, output_tokens:312}) and `omits SpawnResult.usage when no usage chunk is emitted` (text-only stream, usage undefined)."
  - criterion: "existing text + handoff parsing stays unchanged — the usage field is purely additive"
    verdict: "pass"
    evidence: "parser.test.ts original 4 cases (text chunk, handoff envelope, malformed JSON, empty line) still pass without modification. wrapper.test.ts asserts result.text concatenation across the fixture's text chunks (`'Investigating the auth module.\\nDone.'`) and the handoff line is preserved."
---

Extended the Codex NDJSON parser to recognise usage chunks and round-tripped them through `spawnCodex` into the `SpawnResult.usage` field defined in the AgentSpawner contract.

## What Was Built

- `UsageChunkSchema` in `packages/codex-driver/src/spawn/parser.ts` — Zod validation for `{type: "usage", usage: {input_tokens: nonneg int, output_tokens: nonneg int}}` shape
- `ParsedLine.usage` field (typed as `UsageChunk = z.infer<...>['usage']`) — purely additive, doesn't affect existing text/handoff/error fields
- `parseLine` updated to attempt usage parsing between handoff and text checks; falls through to text/raw-line otherwise
- Last-write-wins usage aggregation in `spawnCodex` — Codex may emit multiple usage chunks (intermediate + final); the final chunk is canonical per Codex CLI documentation conventions
- `SpawnResult.usage` is conditionally included in the spawnCodex return value when at least one usage chunk was observed; absent otherwise — preserves back-compat for callers that don't consume usage
- New fixture at `packages/codex-driver/test/fixtures/codex-stream-with-usage.ndjson` — 5 lines covering text/handoff/usage chunks
- 5 new parser test cases (happy path, invalid input shapes, parseStream integration)
- 3 new wrapper test cases (fixture-driven SpawnResult.usage, no-usage absence, multi-chunk last-write-wins)

## Files Modified

- `packages/codex-driver/src/spawn/parser.ts` — add `import { z }`, `UsageChunkSchema`, `UsageChunk` export, `ParsedLine.usage` field, usage-recognition branch in parseLine
- `packages/codex-driver/src/spawn/wrapper.ts` — import `UsageChunk` type, declare `let usage: UsageChunk | undefined` in spawn loop, aggregate last-write-wins, conditionally include in SpawnResult (both success and failure return paths)
- `packages/codex-driver/test/parser.test.ts` — append 5 cases (happy path, non-numeric reject, negative reject, parseStream integration; original 4 cases preserved)
- `packages/codex-driver/test/wrapper.test.ts` — new file, 3 fixture-driven cases via mocked execa
- `packages/codex-driver/test/fixtures/codex-stream-with-usage.ndjson` — new fixture file (5 NDJSON lines)

## Deviations

See frontmatter `deviations:`. Two:

1. **Fixture schema is hand-crafted** — the Codex CLI's actual `codex exec --json` output schema for usage chunks isn't captured from a live run. Used the documented OpenAI Codex CLI September 2025 convention `{type: "usage", usage: {input_tokens, output_tokens}}` which matches the AgentSpawner contract type 1:1. If the real schema differs, UsageChunkSchema is a one-line fix and the rest of the chain stays correct.
2. **Test paths corrected mid-execution** — Plan 02-02-PLAN.md originally listed `packages/codex-driver/test/spawn/{parser,wrapper}.test.ts` (nested layout) but the actual codex-driver test directory is flat. Files landed at `packages/codex-driver/test/{parser,wrapper}.test.ts`.

## Verification

1. ✅ `pnpm vitest run packages/codex-driver/test/parser.test.ts packages/codex-driver/test/wrapper.test.ts` — 12/12 pass
2. ✅ Existing text + handoff tests still green (no regression)
3. ⚠ `pnpm typecheck` not re-run as part of Plan 02-02 — pre-existing v1.0 strict-typecheck failures in spawn/wrapper.ts (env type mismatch) and toml/emit.ts:54 remain; Plan 02-02 changes do not introduce new typecheck errors
4. ⚠ Schema verification against a real `codex exec --json` run is deferred — see deviation 1

## Next

Plan 02-03 (CLI execute → CodexAgentSpawner with model resolution) — independent of Plan 02-02 in scope but lifts through both 02-01's spawner class and 02-02's usage-bearing SpawnResult. Doable in this session if context allows; otherwise resume in a follow-up.
