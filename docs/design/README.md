# Design

> **Status:** in-tree archive landing zone for design documents.
>
> **Canonical reference:** [`TDD2.md` at the repo root](../../TDD2.md) is the live, authoritative design document.

## TDD2 — the live design

[`TDD2.md`](../../TDD2.md) is the single source of truth for v3's architecture. It supersedes the v2-era TDD.md. Any conflict between any other document and TDD2.md is resolved by editing the other document in the same PR.

Reading order:

1. **§1 — Strategic context.** Why v3 exists; what v2 got wrong; the 13-ADR sketch.
2. **§4 — Layered architecture.** From→May-import table; Principle 1 (only runtime imports Pi) + Principle 2 (Pi-isolation) + Principle 3 (Zod at boundaries) + Principle 4 (telemetry aggregate-only).
3. **§5–§9 — Implementation surfaces.** Pi adapter, providers, prompt construction, dispatcher, methodology layer.
4. **§10–§14 — Cross-cutting concerns.** Tier vocabulary, parallel batches, dashboard, testing, cassette infrastructure.
5. **§15–§19 — Ops + governance.** CI/CD, docs, ADRs, observability, risk register.
6. **§22 — ADR seeds.** The 13 ADR skeletons that anchor v3.

## Other design archives

Reserved for design documents that pre-date or supplement TDD2 and need to stay readable for historical context. v3 ships with this directory empty by design — the in-tree posture (per [ADR-013](../decisions/ADR-013-docs-site-posture.md)) keeps the design surface concentrated in TDD2 + the ADRs.

## Why the directory exists

The TDD2 §18.1 topical structure reserves a `docs/design/` slot so future design documents (e.g., a per-milestone design doc when the work becomes complex enough to warrant one) have a known home. Until that lands, this directory is the placeholder + reading-order guide above.
