---
adr: 006
title: Place the Anthropic cache_control breakpoint after artefacts, before task
status: Proposed
decided: 2026-05-11
pr: M4 PR-32
supersedes: TDD2 §8.3
related: ADR-004
---

# ADR-006 — Place the Anthropic cache_control breakpoint after artefacts, before task

**Status:** Proposed (promotes to Accepted when M4 PR-32 lands the implementation)

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
