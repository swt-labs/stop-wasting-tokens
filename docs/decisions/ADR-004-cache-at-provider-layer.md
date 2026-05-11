---
adr: 004
title: cache_control is a provider-layer concern, not a Pi-level one
status: Accepted
decided: 2026-05-11
pr: M1 PR-02
supersedes: TDD2 §22.4
---

# ADR-004 — cache_control is a provider-layer concern, not a Pi-level one

**Status:** Accepted

## Context

Pi exposes session-level conversation compaction (`session.compact(...)` plus
configurable `compaction.{reserveTokens,keepRecentTokens}` settings) but does
NOT expose provider-level prompt caching (Anthropic `cache_control: {type:
'ephemeral'}`, OpenAI auto-cache, Bedrock-via-Anthropic). The v3 acceptance
criterion `cache hit ≥ 70% on Anthropic paths` (TDD2 §1.2) depends on the
latter, not on Pi's compaction.

Two architectural questions follow:
1. Where does cache-control logic live in the package layout?
2. How do we keep the methodology vendor-neutral while still hitting the
   provider-specific cache target?

## Decision

Cache-control breakpoint placement lives in `packages/runtime/src/cache/`,
keyed by `ProviderModelConfig.api`:

- `anthropic-messages` → emit `cache_control: {type: 'ephemeral'}` after the
  deterministic artefact-block prefix, before task-specific content (Anthropic's
  documented ≥1024-token minimum gates whether the breakpoint actually emits;
  fallback documented in ADR-006).
- `openai-completions` → trust OpenAI's auto-cache; record cache_read tokens
  from `usage.prompt_tokens_details.cached_tokens`.
- `google-generative-ai`, `openai-responses`, other Pi-supported APIs → no-op
  for now; new providers with novel caching semantics get their own file under
  `cache/` plus an ADR that supersedes this one for their case.

Pi's compaction stays on Pi's side, configured per role per TDD2 §8.5. The two
concerns are independent: compaction shrinks long conversations; cache_control
amortises stable prefixes across requests. The methodology layer never names
either — it asks for tier `quality` / role `dev`; the runtime layer figures out
the caching strategy from `ProviderModelConfig.api`.

## Consequences

Easier:
- Clean concern separation: the M4 cache-hit target is satisfiable in
  `packages/runtime/src/cache/`, not by mutating the methodology layer.
- Provider-specific cache logic is testable in isolation against cassettes
  (Plan 01-02 PR-06 / Plan 04 PR-32).
- Per-provider cassettes verify per-provider strategies — divergence between
  Anthropic's body-side `cache_control` and OpenAI's transparent auto-cache
  stays observable rather than papered over.

Harder:
- The "≥70% cache hit" target now lives in §8.2.1 of TDD2; the test that proves
  it (`packages/test-utils/cassettes/*.jsonl` + the M4 cache-hit panel) sits
  alongside the implementation, not in `packages/runtime/` proper.
- Adding a new provider with novel caching semantics (e.g., a future provider
  that wants header-based prompt caching) requires its own file under
  `cache/` plus an ADR that supersedes this one for the new provider.
- The cassette recorder MUST normalise `cache_control` markers before computing
  the request body hash — otherwise byte-identical replay degrades (per TDD2
  §14.7.1 mitigation). This is locked into the cassette format from Plan 01-02
  PR-06 onward.
