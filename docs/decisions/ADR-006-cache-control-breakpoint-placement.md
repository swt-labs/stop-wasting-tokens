---
adr: 006
title: Place the Anthropic cache_control breakpoint after artefacts, before task
status: Accepted
decided: 2026-05-12
pr: M4 PR-32 (implementation) + PR-38 (promotion)
supersedes: TDD2 §8.3
related: ADR-004
---

# ADR-006 — Place the Anthropic cache_control breakpoint after artefacts, before task

**Status:** Accepted (M4 PR-32 shipped the implementation; PR-38 promoted at Plan 04-01 close)

## Context

Anthropic's prompt-caching feature requires a minimum of 1024 tokens between
cache breakpoints. The cache-hit win comes from caching the _stable_ prefix —
role system prompt + project artefacts (PROJECT, REQUIREMENTS, STATE, phase
context) — and **not** caching the variable suffix (task brief + must-haves +
files-changed scratchpad). If the breakpoint sits at the wrong index, either
the cache misses every turn (placed too early) or the breakpoint never qualifies
(placed too late). Hard requirement: TDD2 §1.2's "cache hit ≥70%" target on a
5-task phase of the `ref-fastapi` scenario.

OpenAI auto-caches eligible prefixes server-side without an explicit breakpoint,
so this decision is Anthropic-specific. The provider-quirks layer (ADR-003)
already knows which providers honour `cache_control`; ADR-006 is about WHERE in
the prompt the breakpoint goes for the providers that do.

## Decision

`buildPrompt()` (TDD2 §8.3) emits blocks in fixed order:

1. role system prompt
2. PROJECT.md + REQUIREMENTS.md
3. STATE.md
4. phase context (`{NN}-CONTEXT.md`)
5. **`cacheBreakpointIndex` ← cache_control marker inserted here**
6. task brief (TaskBrief)
7. must-haves checklist
8. files-changed scratchpad

The marker is added as a `cache_control: { type: 'ephemeral' }` field on the
last content block of section 4 (per Anthropic's per-block API surface).
M4 PR-32 implements `buildPrompt`; the ordering is fixed at the methodology
layer so provider differences don't cascade into the prompt-construction code.

If sections 1–4 are below 1024 tokens, `buildPrompt` omits the breakpoint
and surfaces a dashboard warning. The methodology continues without caching
rather than emit an invalid Anthropic request.

## Consequences

Easier:

- The ≥70% cache-hit M4 target becomes mechanical: stable prefix + breakpoint.
- `buildPrompt` is a pure function — easy to unit-test prompt structure without
  Pi running.
- Tier downgrade (ADR-007 Budget Gate) doesn't move the breakpoint; the
  cached prefix is reusable across providers when an Anthropic fallback fires
  back to OpenAI (which uses its own auto-cache).

Harder:

- If a project's artefact prefix drops below 1024 tokens (e.g., a small
  scaffolding phase), the breakpoint is skipped and the cache hit ratio
  drops. Documented in §13.4.3 R-04 as a known mitigation path. The
  dashboard's Cache Hit panel surfaces this so operators see it.
- Updating PROJECT.md or REQUIREMENTS.md invalidates the cache mid-milestone.
  Acceptable: those files don't change inside a phase under v3's plan-then-
  execute methodology.

## Validation (M4 PR-38, 2026-05-12)

Four implementation layers validate the decision:

**Layer 1 — Deterministic prompt construction (PR-31).** `buildPrompt(opts)` in `packages/orchestration/src/prompt-builder.ts` is a pure function of `BuildPromptOptions`. No clock, no random, no env reads. Two calls with the same opts produce byte-identical `blocks` + `cacheBreakpointIndex`. Validated by `packages/orchestration/test/prompt-builder.determinism.test.ts` (9 tests: pure determinism, property-order independence, canonical golden snapshot pinning `cacheBreakpointIndex: 5` for a fully-populated prompt, optional-block shifting, `serializeBlocks` format).

**Layer 2 — Anthropic wire-side insertion (PR-32).** `applyCacheControl({blocks, cacheBreakpointIndex, provider})` in `packages/runtime/src/providers/cache-control.ts` threads `cache_control: {type: 'ephemeral'}` onto the LAST block before the breakpoint when the provider is Anthropic and the prefix meets the 1024-token minimum. Three structured skip reasons (`prefix-too-small`, `provider-not-anthropic`, `no-blocks-before-breakpoint`) surface as telemetry; the methodology layer can downgrade tier or warn the operator. Validated by `packages/runtime/test/providers/cache-control.test.ts` (12 tests including the exact-cap boundary at 1024 estimated tokens).

**Layer 3 — Per-provider cache observability (PR-33 + PR-34).** `computeCacheHitRatio(snapshot)` in `packages/runtime/src/meter/cache-hit.ts` aggregates `cacheRead / (cacheRead + cacheWrite + input)` per provider. Anthropic extractor captures `cache_read_input_tokens` + `cache_creation_input_tokens`; OpenAI extractor captures `prompt_tokens_details.cached_tokens`. Validated by `packages/runtime/test/meter/cache-hit.test.ts` (9 tests) + `packages/runtime/test/providers/openai-auto-cache.test.ts` (6 tests, including a 10-turn sustained-cache run that hits the ≥70% M4 target).

**Layer 4 — Operator-facing observability (PR-33 + PR-37).** Dashboard's `CacheHitPanel` (live ratio with red/amber/green threshold pills) + `TpacPanel` (delta-vs-baseline badge) make the M4 EXIT GATE measurable from the dashboard. Validated by route tests + SolidJS empty-state coverage.

The "<1024 tokens → skip + warn" mitigation path documented under "Consequences > Harder" is exercised by the `prefix-too-small` skip-reason path in the cache-control tests; the dashboard's CacheHitPanel renders the resulting low ratio in red so operators see the cause.
