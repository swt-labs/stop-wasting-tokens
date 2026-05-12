---
adr: 001
title: Pi SDK as the runtime substrate
status: Accepted
decided: 2026-05-11
pr: M1 PR-02
supersedes: TDD2 §22.1
---

# ADR-001 — Pi SDK as the runtime substrate

**Status:** Accepted

## Context

SWT v2.x runs methodology over the Codex CLI as a subprocess. This worked but
created an architectural ceiling: vendor-coupling, no token meter, no parallelism,
crash-unsafe. Three driver packages (`@swt-labs/codex-driver`,
`@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver`) duplicated logic and
left a `methodology → codex-driver` source-import edge that violated Principle 1
(methodology vendor-neutrality).

## Decision

Adopt `@earendil-works/pi-coding-agent` (and `@earendil-works/pi-ai`) as the
runtime substrate for v3. Replace the runtime layer; preserve the methodology
layer. The new `packages/runtime/` (introduced in this PR) wraps Pi behind a
vendor-neutral `createSession()` factory and exposes cwd-scoped tool factories.
Concrete provider configuration moves to `packages/runtime/src/providers/quirks.json`
(ADR-003); the three v2 driver packages are deleted wholesale (ADR-005).

The peer-dependency policy follows Pi's docs: `packages/runtime/` declares
`@earendil-works/pi-coding-agent` as a `peerDependencies: "*"` plus a pinned-range
`dependencies` entry (currently `^0.74.0`) — the pin enables reproducible builds
(ADR-010); the peer accepts whatever compatible version the host repo resolved.

## Consequences

Easier:

- One runtime to maintain. Methodology never speaks provider strings.
- Vendor abstraction comes "free" via Pi's provider catalogue (25+ providers).
- Per-task fresh sessions and crash safety are inherent to Pi's session model.
- Token meter and cache observability inherent to provider-level integration.
- The `methodology → driver` edge no longer exists — methodology imports `AgentSpawner`
  from `@swt-labs/core/abstractions`; the runtime layer fulfils it.

Harder:

- Pi is pre-1.0; we accept API churn risk. The pinned-range dep + cassette-replay
  determinism (Plan 01-02 PR-06/07) cushion this.
- Some Pi-specific patterns (Extensions, custom tools, Pi's session entry model)
  need to be learned. ADR-002 covers the result-protocol idiom that uses them.
- The constitutional debt edges in v2.3.5 must be discharged first (M1 entry gate,
  PR-01a + PR-01b — already merged before this PR).
