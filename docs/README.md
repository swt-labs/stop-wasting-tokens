# SWT documentation

This is the in-tree documentation for SWT v3 — Pi-Native Coding Harness. Per [ADR-013](./decisions/ADR-013-docs-site-posture.md), v3.0 ships without a hosted documentation site; `docs/` is the authoritative user-facing surface. Re-evaluation triggers documented in ADR-013's body.

> **Authoritative design:** [`TDD2.md`](../TDD2.md) at the repo root.
> **Live planning:** [`.vbw-planning/ROADMAP.md`](../.vbw-planning/ROADMAP.md) + per-milestone plans in `.vbw-planning/phases/`.
> **Decisions:** [`docs/decisions/`](./decisions/) — 13 ADRs, indexed by [`decisions/README.md`](./decisions/README.md).

## How to use this site

The in-tree docs follow the TDD2 §18.1 topical structure. Each top-level folder is one architectural layer or one operational concern; each file is one user-facing topic.

| Folder                               | Topic                                                                      | Read this if you want to know…                                                      |
| :----------------------------------- | :------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| [`methodology/`](./methodology/)     | The six-agent SDLC + plan-then-execute lifecycle                           | How SWT's methodology layer is organised; what's preserved from v2 vs new in v3.    |
| [`runtime/`](./runtime/)             | The Pi runtime adapter                                                     | How SWT talks to Pi; how providers map to tiers; how the meter and extractors work. |
| [`orchestration/`](./orchestration/) | Dispatcher + worktrees + claims + DAG                                      | How v3 will run parallel Dev tasks (M3); how crash recovery works.                  |
| [`dashboard/`](./dashboard/)         | Localhost web dashboard panels + actions                                   | What panels render; how `Cmd-K` navigation works; how permission gates render.      |
| [`cli/`](./cli/)                     | `swt` verb reference                                                       | What each verb does; which verbs are real vs placeholders this milestone.           |
| [`operations/`](./operations/)       | Migrating from v2 + observability + budget + failover + cassette recording | How to migrate, run, monitor, recover, and record proof.                            |
| [`decisions/`](./decisions/)         | 13 Architecture Decision Records                                           | Why specific architectural choices were made; status lifecycle.                     |
| [`design/`](./design/)               | Design archive + TDD2 reading-order guide                                  | Where to start when reading TDD2.md end-to-end.                                     |

## v2-era Mintlify-format docs

The v2 documentation was authored for a Mintlify-hosted site at `docs.stopwastingtokens.dev`. ADR-013 deferred the hosted-site posture for v3.0; the existing `.mdx` files at `docs/concepts/`, `docs/getting-started/`, `docs/recipes/`, `docs/reference/`, `docs/migration/`, `docs/blog/`, and `docs/v1-5-roadmap/` remain in place and stay useful:

- They render in GitHub's `.md`/`.mdx` viewer for in-browser reading.
- Mintlify-specific components (Card, Callout, etc.) degrade gracefully to inline text on GitHub.
- The migration-from-v2 guide at [`operations/migrating-from-v2.md`](./operations/migrating-from-v2.md) is the canonical user-facing migration doc — supersedes anything under `docs/migration/`.

If/when the user count crosses ~1000 and the hosted site re-opens (per ADR-013 re-evaluation criteria), the `.mdx` files become the input; the new topical `.md` files in this index become the table-of-contents source.

## Status table by topic

| Topic         | Current state at M1 close                                                                                                                                                                                                                                                              |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Methodology   | Inherited from v2 verbatim; v3-specific additions stubbed in [`methodology/README.md`](./methodology/README.md) for now.                                                                                                                                                               |
| Runtime       | [Pi integration](./runtime/pi-integration.md), [extensions](./runtime/extensions.md), [providers](./runtime/providers.md), [caching](./runtime/caching.md) all stubs with pointers; the implementing code lives in `packages/runtime/` (shipped in Plans 01-01 + 01-02).               |
| Orchestration | [worktrees](./orchestration/worktrees.md), [claims](./orchestration/claims.md), [DAG](./orchestration/dag.md), [crash recovery](./orchestration/crash-recovery.md) all stubs — M3 fills them in.                                                                                       |
| Dashboard     | [Panels](./dashboard/panels.md), [permission gates](./dashboard/permission-gates.md), [Cmd-K](./dashboard/cmd-k.md) stubs — most expand at M2 + M4.                                                                                                                                    |
| CLI           | [README](./cli/README.md) summary + per-milestone delta table. Existing per-verb docs at `docs/reference/cli.mdx` (v2-era) remain accurate until each verb's v3 changes ship.                                                                                                          |
| Operations    | [Migrating from v2](./operations/migrating-from-v2.md) (315-line full guide) + [cassette recording](./operations/cassette-recording.md) (full guide) + [observability](./operations/observability.md) / [budget](./operations/budget.md) / [failover](./operations/failover.md) stubs. |
| Decisions     | 13 ADRs — 6 Accepted, 6 Proposed, 1 Deferred. Index at [`decisions/README.md`](./decisions/README.md).                                                                                                                                                                                 |
| Design        | TDD2 reading-order guide + reserved archive slot.                                                                                                                                                                                                                                      |

## Quick links for common tasks

- **Migrating from v2.x?** → [`operations/migrating-from-v2.md`](./operations/migrating-from-v2.md)
- **Recording a cassette?** → [`operations/cassette-recording.md`](./operations/cassette-recording.md)
- **Reading the architecture?** → [`TDD2.md`](../TDD2.md) (with [`design/README.md`](./design/README.md) as the reading-order guide)
- **Looking up a decision?** → [`decisions/README.md`](./decisions/README.md)
- **Looking up a CLI verb?** → [`reference/cli.mdx`](./reference/cli.mdx) (v2-era; v3 deltas in [`cli/README.md`](./cli/README.md))

---

## Mintlify package metadata (preserved)

This directory is also a workspace package (`@swt-labs/docs`) so the existing
Mintlify tooling (`pnpm --filter @swt-labs/docs dev` / `build` / `lint:vale`
/ `test`) keeps working until the hosted-site posture re-opens. The
preserved Mintlify-specific notes from the v2.x version of this README are
captured below for any contributor working on the docs package itself.

### Local development

```bash
pnpm install
pnpm --filter @swt-labs/docs dev
# Open http://localhost:3000
```

### Build (preview)

```bash
pnpm --filter @swt-labs/docs build
```

### Prose linting

Vale (Microsoft + write-good styles + SWT vocabulary) runs on every PR
touching `docs/**`:

```bash
pnpm --filter @swt-labs/docs lint:vale
```

### Structure test

`test/structure.test.ts` validates `docs.json` parses + every page reference
resolves. Run via `pnpm --filter @swt-labs/docs test`.

### Editing tips

- Mintlify components (`<CardGroup>`, `<Card>`, `<CodeGroup>`, `<Tabs>`)
  degrade gracefully on GitHub; you can keep using them.
- Add new project-specific terms to `styles/config/vocabularies/SWT/accept.txt`
  instead of fighting Vale.
- Reference docs (`reference/`) can be denser than conversational pages.
