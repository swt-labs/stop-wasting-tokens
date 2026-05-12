# Runtime — Caching

> **Status:** stub — expanded at M4 (cache-control + Budget Gate).
>
> **Canonical reference:** [`TDD2.md` §8.2 (provider-shim caching)](../../TDD2.md).
> **Owning ADRs:** [ADR-004 — Cache_control at provider-shim layer](../decisions/ADR-004-cache-at-provider-layer.md) · [ADR-006 — Cache-control breakpoint placement](../decisions/ADR-006-cache-control-breakpoint-placement.md).

SWT v3's caching strategy:

- **Pi has no native `cache_control` API** — per recon verified against `pi.dev/docs/latest`. Caching is provider-specific.
- **Anthropic** — body-side `cache_control: { type: 'ephemeral' }` markers per content block. ≥1024 tokens between markers; SWT places the marker after artefacts, before task content (per ADR-006). Cache hit ≥70% is an M4 hard requirement.
- **OpenAI** — auto-caches eligible prefixes server-side. No explicit marker needed.
- **Other providers** — best-effort via the generic provider quirks layer; cache hit metrics surface in the dashboard's Cache Hit panel.

## Where the policy lives

| Layer                                  | What it does                                                                                                                                                                            |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Methodology / `buildPrompt` (M4 PR-32) | Emits blocks in fixed order (PROJECT → REQUIREMENTS → STATE → phase context → cache breakpoint → task brief → must-haves).                                                              |
| Runtime / provider shim (this layer)   | Applies the breakpoint at `cacheBreakpointIndex` for Anthropic only; no-op for OpenAI auto-cache; quirks.json describes per-provider behaviour via `compat.supportsLongCacheRetention`. |
| Dashboard Cache Hit panel (M4)         | Surfaces the per-milestone cache-hit ratio. Operators see when the ≥70% target is missed and why (artefact prefix < 1024 tokens; cache invalidated; provider doesn't support caching).  |

## Why provider-shim, not Pi-level

Per ADR-004:

- Pi doesn't ship a `cache_control` primitive; building one inside Pi would couple it to Anthropic's specific shape.
- Provider quirks are already provider-specific (per ADR-003); caching is one more axis on the same surface.
- Future providers with novel caching mechanics slot into `quirks.json` without runtime changes.

## What lives elsewhere

- Token meter that measures the cache-hit ratio → `runtime/src/meter/` (PR-07).
- Budget Gate that pauses when caching fails to control cost → [ADR-007](../decisions/ADR-007-budget-gate-semantics.md) + M4 PR-35.
- Cassette-recorded cache hits used for the byte-identical replay assertion → `runtime/test/meter/cassette-replay.int.test.ts` + the cassette recording session.
