---
adr: 003
title: Provider quirks live in a JSON file applied via Pi Extension, not per-provider TS shims
status: Accepted
decided: 2026-05-11
pr: M1 PR-08
supersedes: TDD2 §7.5
related: ADR-001, ADR-004, ADR-005
---

# ADR-003 — Provider quirks live in `quirks.json` applied via Pi Extension; not per-provider TS shims

**Status:** Accepted

## Context

Pi (`@earendil-works/pi-coding-agent`) ships with a built-in provider
catalogue (Anthropic, OpenAI, OpenRouter, Google, Bedrock, Ollama, …)
and a small set of compatibility flags it consults at request-build time
(`thinkingFormat`, `maxTokensField`, `supportsDeveloperRole`,
`supportsReasoningEffort`, `supportsLongCacheRetention`, …). SWT needs
to add a handful of vendor-specific deltas on top of Pi's defaults:

- Anthropic-only `supportsLongCacheRetention: true` (the v3 cache-control
  bet — see ADR-004).
- OpenAI `gpt-5*` models: `maxTokensField = "max_completion_tokens"` and
  `supportsReasoningEffort: true`.
- OpenRouter sub-routes for `deepseek/*` / `moonshotai/*` /
  `anthropic/*` / `openai/*` that need different `thinkingFormat` and
  `maxTokensField` values than the OpenRouter base.
- Per-model `thinkingLevelMap` entries that translate Pi's neutral
  `ThinkingLevel` vocabulary (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`)
  to provider-specific effort strings (Anthropic `"low"`/`"medium"`/`"high"`,
  OpenAI same set, deepseek `"think"`, …).

Two viable shapes for this layer:

1. **Per-provider TypeScript shims.** Folder of `providers/{anthropic,openai,…}.ts`
   files, each exporting an object literal of overrides, all imported and
   passed to a `registerAllProviders()` function at runtime startup.
2. **One `quirks.json` file applied via a single Pi Extension** that
   walks the JSON and calls `pi.registerProvider(...)` per entry.

v2's codex-driver took shape (1) — twelve hand-rolled TypeScript files
under `packages/codex-driver/src/providers/` plus a registration entry
point. That layout produced four observed pains:

- **Diff noise.** Every Anthropic price update or OpenAI model-id addition
  required a TS edit (often a one-line change buried in a 200-line file)
  plus a re-run of the typecheck. Schema migrations needed coordinated edits
  across all twelve files.
- **Type drift.** Each shim re-declared its own ad-hoc shape; Pi's actual
  `ProviderModelConfig` shape evolved across Pi versions and the shims fell
  behind. Several pre-existing v2.3.5 test failures trace back to shim
  shape drift.
- **Onboarding cost.** Adding a new provider was a 4-step ceremony (new
  TS file + add to barrel + add to `registerAllProviders` + write tests),
  not a one-line JSON edit.
- **Coupling.** The shim files imported provider names + tier names from a
  hand-maintained TS enum. The well-known TDD2 regression bug —
  `thinkingLevelMap` keys accidentally written as SWT *tier* names
  (`balanced`, `quality`) instead of Pi *ThinkingLevel* values
  (`low`, `medium`) — could happen at any of the twelve shim files, with
  no central place to assert the invariant.

The audit gap caught in Plan 01-01 noted that TDD2's draft of this
provider layer mixed the two vocabularies. Whichever shape ships in v3
needs a single enforceable schema check.

## Decision

Provider quirks live in **one JSON file** —
`packages/runtime/src/providers/quirks.json` — and are applied via a
**single Pi Extension** —
`packages/runtime/src/extensions/provider-overrides.ts` — that walks the
JSON at extension-registration time and calls `pi.registerProvider(...)`
per provider entry.

Concretely:

- The JSON schema is loose-typed (TypeScript `Record<string,
  ProviderQuirk>` + Zod schema for the test gate) so adding a provider
  is a JSON edit, not a TS edit.
- `thinkingLevelMap` keys are validated by a runtime Zod schema test
  (`runtime/test/providers/quirks-schema.test.ts`) that asserts every key
  is a Pi `ThinkingLevel` value (`off`/`minimal`/`low`/`medium`/`high`/
  `xhigh`) and **not** a SWT tier name. The test fails the CI build
  if a future contributor reintroduces the TDD2 regression.
- `default-tiers.json` is a separate JSON file for the per-provider
  per-tier model map (orthogonal axis). The role-resolver layer
  (`runtime/src/providers/role-resolver.ts`) is the only place that
  reads both — quirks describe *how Pi talks to the provider*; default
  tiers describe *which model id maps to which SWT tier*.
- The Extension factory in `extensions/provider-overrides.ts` is a Pi-side
  artifact; orchestration and methodology never see it. Per the Layer 1
  Pi-isolation invariant (Principle 2 / ADR-001), only `@swt-labs/runtime`
  imports `@earendil-works/pi-coding-agent`.
- Per-ROLE thinking-level resolution lives in
  `resolveThinkingLevelForRole(role)`, **not** per-tier. Two roles with
  the same tier (Architect: `quality`, Dev: `balanced`) can want
  different thinking budgets (Architect: `medium`, Dev: `low`). This is
  TDD2 §10.5 made enforceable.

## Consequences

Easier:
- Adding a provider or tweaking a model override is a JSON edit; CI
  runs the Zod schema test and the regression test, then merges.
- One Zod schema test (`quirks-schema.test.ts`) covers all providers
  for the `thinkingLevelMap`-keys-must-be-`ThinkingLevel` invariant —
  the TDD2 bug can never silently regrow.
- Dashboard and tooling can read `quirks.json` directly (no TS
  module-load required) when displaying "what compat flags apply to
  this provider?" panels.
- M3 (parallel) and M4 (verification) inherit the same provider layer
  without re-litigating the layout — they just spawn more agents through
  the same role-resolver.

Harder:
- JSON is less expressive than TS: no comments (works around it with a
  `_comment` key), no conditional logic, no imports. If a future
  provider needs computed quirks (e.g., "use `gpt-5-pro` for tasks
  with >100k tokens, else `gpt-5`"), this layer would need a small
  resolver step. v3 ships without that path; it is M5-scope if ever.
- Pi's `pi.registerProvider` signature is not yet pinned (Pi 0.74 is
  marked alpha). The Extension factory in PR-08 compiles the config
  shapes but defers the actual `registerProvider` call until PR-09's
  cassette infrastructure lets us assert the wiring works against a
  real Pi session. The unit-test test seam (`buildAllProviderConfigs()`)
  validates the build step in isolation until then.
- JSON loaded via `import quirks from './quirks.json' with { type: 'json' }`
  requires Node ≥ 22 / TS 5.3+ for the import-assertion syntax. v3
  already requires Node ≥ 20 and TS 5.6 (see `tsconfig.base.json`), so
  this is not a new constraint.
