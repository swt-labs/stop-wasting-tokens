---
adr: 005
title: Delete codex-driver, claude-code-driver, ollama-driver wholesale; no co-existence
status: Accepted
decided: 2026-05-11
pr: M1 PR-05
supersedes: TDD2 §22.5
---

# ADR-005 — Delete codex/claude-code/ollama-driver wholesale; no co-existence

**Status:** Accepted

## Context

v2.x shipped three driver packages — `@swt-labs/codex-driver`,
`@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver` — each wrapping a
specific local CLI/runtime subprocess (Codex CLI, Claude Code, Ollama). A
"v3 with toggleable backends" design that kept these three around would:

- multiply the surface area to maintain (three subprocess models, three
  log-parsing pipelines, three test matrices);
- let a `methodology → driver` source-import edge re-emerge (the very
  edge M1 PR-01a + PR-01b just discharged);
- force every v3 feature (cache-control, token-meter dimensions, parallel
  worktrees, the Extension result protocol) to ship in three flavours and
  prove behavioural equivalence;
- give v3 no escape hatch for Pi's native provider catalogue (25+
  providers) — every Pi provider would need a parallel driver shim.

M1 entry-gate work (PR-01a/01b) cleared the source-import edges that
would have re-coupled methodology / cli back to these drivers, so the
runtime layer is the only thing still importing them — and the runtime
layer in v3 is `@swt-labs/runtime` (the Pi adapter), not the legacy
driver packages.

## Decision

Delete `packages/{codex,claude-code,ollama}-driver/` wholesale at M1 PR-05.
No re-export shims, no compatibility layer, no `--legacy-driver` flag.
The user migration story is:

- **Codex CLI users:** route through Pi's OpenAI / OpenAI-compat provider
  (Codex's underlying API surface) via `runtime/providers/quirks.json`.
- **Claude Code users:** route through Pi's Anthropic provider.
- **Ollama users:** route through Pi's Ollama provider (the only path
  the Ollama driver actually exercised was `OLLAMA_HOST` + `/api/chat`,
  which Pi handles natively).
- The deprecation/migration path is documented in `docs/operations/migrating-from-v2.md`
  (lands in M1 PR-10) and the `swt migrate --to=v3` script (lands in M6 PR-49).

`.codex-plugin/` (the legacy Codex MCP wiring at repo root) is deleted in
the same PR — it was scaffolding for the codex-driver's plugin manifest
and has no v3 counterpart.

The three driver packages were marked `private: true` in v2 and have HTTP
404s on the npm registry (verified at PR-05 execution time). No public
npm consumers can break. The `publishConfig.access: public` setting on
each driver was aspirational; `private: true` was the actual safety net
that prevented publication. Both flags removed by virtue of the package
deletion.

## Consequences

Easier:

- One runtime path to maintain: methodology → orchestration → runtime → Pi.
- M1 PR-05 deletes 3 packages, ~50 source files, ~20 test files — all
  auditable in one diff. No "what stayed for legacy reasons" mental
  overhead.
- The 4 source-import edges that PR-01a + PR-01b broke can never
  silently regrow — the import targets no longer exist on disk.
- Pi peerDep tracking moves to one package (`@swt-labs/runtime`) instead
  of three drivers each with their own version requirements.

Harder:

- v2.x users without Pi-supported providers have nowhere to land at v3
  ship. Mitigation: `swt migrate --to=v3` (M6 PR-49) is the only support
  path. The previously-planned 6-month LTS (ADR-012) was retracted, so
  users who cannot migrate pin to a specific v2.3.x tarball on npm.
- Anyone who had local forks of the driver packages will lose the
  upstream merge path. Mitigation: the v2.3.5 source is still reachable
  via git history on `main` (final pre-pivot commit) and via the v2.3.x
  tarballs on npm; rebase forks against that snapshot.
- The codex-specific `AGENTS.md` per-role TOML blocks that v2's
  codex-driver wrote are gone — Pi reads the user's existing AGENTS.md
  natively (single file, no per-role variants), which is a behaviour
  change for v2 users with deeply-customised AGENTS.md layouts. The
  migration guide (M1 PR-10 Task 2) documents the transition.
