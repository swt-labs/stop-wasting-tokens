# stop-wasting-tokens

Methodology-first SDLC for vendor-agnostic coding agents.

> **This repo is mid-pivot.** `main` now reflects the **v3 redesign in progress**. The v2.3.5 codebase is preserved on the [`v2-archive` branch](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive) and at all release tags `v1.0.0` through `v2.3.5`. The `stop-wasting-tokens@2.3.5` npm package is unaffected and continues to work as before.

## What you're looking at

- **[`TDD2.md`](./TDD2.md)** — authoritative v3 technical design (≈266 KB). The full v3 plan; start here.
- **[`docs/testing.md`](./docs/testing.md)** — one-page consolidation of the 12 test categories + 2 hard merge gates that v3 must cross before beta. Read this if your question is "how do we know the code works before beta?"
- [`TDD.md`](./TDD.md) — original v3 design (historical record; superseded by TDD2).
- [`CHANGELOG.md`](./CHANGELOG.md) — workspace + repo history.
- [`CLAUDE.md`](./CLAUDE.md) — VBW context file (active milestone, plugin rules).
- `.vbw-planning/PROJECT.md` — v3 project context + 20-row Key Decisions table.
- `.vbw-planning/REQUIREMENTS.md` — 27 v3 requirements (`REQ-01..REQ-27`).
- `.vbw-planning/ROADMAP.md` — 6 phases (M1 Foundation → M6 Decommission/Ship).
- `.vbw-planning/STATE.md` — live activity log.
- `.vbw-planning/phases/01-m1-foundation/` — M1 plans: `01-RESEARCH.md`, `01-01-PLAN.md`, `01-02-PLAN.md`, `01-03-PLAN.md`.
- `.vbw-planning/research/recon.md` — verified fact-base from v2.3.5 source + Pi docs (2026-05-11).

## v3 status

**v3.0 has not shipped yet.** The design is locked (TDD2.md); execution proceeds through 12 PRs over ~13 weeks per TDD2 §13.

| Milestone | Goal | Status |
|---|---|---|
| **M1 Foundation** | Entry-gate edge breaks + architectural scaffolding | Plans written (`01-01..01-03`) |
| M2 Single-agent path | Pi end-to-end, TPAC baseline | Pending |
| M3 Worktree dispatcher | Parallel Dev tasks + crash recovery | Pending |
| M4 Token meter & cache discipline | TPAC −40% vs M2 baseline | Pending |
| M5 Multi-provider | Cross-vendor parallelism | Pending |
| M6 Decommission, benchmark, ship | v3.0 ships | Pending |

Track progress in [`.vbw-planning/STATE.md`](./.vbw-planning/STATE.md).

## How v3 proves correctness before beta

Pre-beta confidence is enforced by a **layered gate system**, not a single test pass. The full breakdown is in **[`docs/testing.md`](./docs/testing.md)**; the short version:

- **12 test categories** — unit, integration, e2e, cassette infrastructure, token-meter regression, v2 regression, provider matrix, golden artefact bundles, performance/TPAC, chaos/crash-recovery, static-check ladder, isolation rules.
- **2 hard merge gates that cannot be bypassed:**
  - **M1 PR-07** — token meter `delta = 0` on cassette replay (any non-determinism in token counting fails CI)
  - **M4 PR-36** — TPAC −40% vs M2 baseline on `ref-fastapi` (the optimization must materialize, or the milestone-finishing PR cannot merge)
- **Reproducible-build job** on every push to main — `pnpm build` twice; any byte-diff in `dist/` fails.
- **Beta begins only after M6 exit gate passes** — full unit + integration + provider-matrix + regression + e2e + chaos + reproducible-build suites all green, plus published public benchmark.

If beta surfaces a bug, the fix lands together with a new test that would have caught it. No exceptions.

## I'm here to use v2

v2.3.5 is the last shipped release of `stop-wasting-tokens` and remains fully supported per the LTS policy.

- **Install:** `npm install -g stop-wasting-tokens@2`
- **Source:** [`v2-archive` branch](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive) or the [`v2.3.5` release tag](https://github.com/swt-labs/stop-wasting-tokens/releases/tag/stop-wasting-tokens%402.3.5)
- **Release history:** git tags `v1.0.0` through `v2.3.5`
- **v2 LTS policy:** per TDD2 §17.6, v2.3.x receives security + critical-bug-fix patches for **6 months from v3.0 ship date**. Security: 7-day backport SLA. Data-loss / install-breaking: 14-day. Regression: 30-day.

## I want to build / contribute to v3

1. **Read [`TDD2.md`](./TDD2.md) first.** It's the authoritative design.
2. **Read [`recon.md`](./.vbw-planning/research/recon.md)** — the verified-fact basis TDD2 was authored against.
3. **Read the M1 plans in order:** `01-RESEARCH.md` → `01-01-PLAN.md` → `01-02-PLAN.md` → `01-03-PLAN.md`.
4. **Cut a `v3-foundation` branch from `v2-archive`.** v3 code work modifies v2.3.5 source (PR-01a breaks the `methodology → codex-driver` edge; PR-01b breaks three `cli → driver` edges; subsequent PRs add `runtime/`, `orchestration/`, `shared/`, etc.). Start from the v2 codebase, not from a blank slate.
5. **Execute PR-01a first.** It's the M1 entry gate (TDD2 §13.1.1). Do not begin Pi-related work until PR-01a + PR-01b are merged on `v3-foundation` and the grep invariant passes.

## Branch layout

| Branch | Contents | Purpose |
|---|---|---|
| `main` | v3 design + plans (this) | Default view; what v3 looks like + how to get there |
| `v2-archive` | v2.3.5 source tree | Permanent reference; LTS patch base |
| `v3-foundation` (created later) | v2.3.5 + incremental v3 changes | Active v3 implementation work, cut from `v2-archive` |
| `release/v2.3-lts` (created at v3.0 ship) | LTS-only changes against v2.3.x | Security/critical-bug backports for 6 months post-ship |
| `dependabot/*` | Automated dep bumps | Target `v2-archive`, not `main`, until v3.0 ships |

## Conflict resolution

If anything in `.vbw-planning/` disagrees with `TDD2.md`, **TDD2 wins**. The state files all carry an "Authoritative source: TDD2.md" pointer at the top.

## Authoring

The v3 design + planning was assembled with [VBW](https://github.com/swt-labs/vibe-better-with-claude-code-vbw) — the same methodology layer that v3 itself rewrites in Pi. v3 will eventually run on `@earendil-works/pi-coding-agent` instead of the Codex CLI subprocess (TDD2 §1.3, §5.1).

## License

MIT.
