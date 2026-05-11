# stop-wasting-tokens v3 — Planning Workspace

Design and planning artifacts for the **SWT v2.3.5 → v3.0 rewrite**.

Live code lives at [`swt-labs/stop-wasting-tokens`](https://github.com/swt-labs/stop-wasting-tokens). **This repo is the design** — TDDs, plans, ADR seeds, recon research, and the VBW state that bridges TDD2 to executable PR-by-PR work.

## What's here

| File | Purpose |
|---|---|
| **[`TDD2.md`](./TDD2.md)** | **Authoritative v3 technical design** (≈266 KB). Start here. Supersedes `TDD.md`. |
| [`TDD.md`](./TDD.md) | Original v3 design (preserved as historical record). |
| [`CHANGELOG.md`](./CHANGELOG.md) | Notable changes to this workspace. |
| [`CLAUDE.md`](./CLAUDE.md) | VBW context file — active milestone, rules, plugin isolation. |
| `.vbw-planning/PROJECT.md` | v3 project context + Key Decisions (20 rows). |
| `.vbw-planning/REQUIREMENTS.md` | 27 v3 requirements (`REQ-01..REQ-27`). |
| `.vbw-planning/ROADMAP.md` | 6 phases (M1 Foundation → M6 Decommission/Ship). |
| `.vbw-planning/STATE.md` | Live state + activity log (all substantive work passes recorded). |
| `.vbw-planning/phases/01-m1-foundation/` | M1 plans — `01-RESEARCH.md`, `01-01-PLAN.md`, `01-02-PLAN.md`, `01-03-PLAN.md`. |
| `.vbw-planning/research/recon.md` | Ground-truth fact-base from v2.3.5 source + Pi docs (fetched 2026-05-11). |

## How to use this workspace

1. **Read [`TDD2.md`](./TDD2.md) first.** It's the design. Everything else points back to it.
2. **Read [`recon.md`](./.vbw-planning/research/recon.md)** — the verified-fact basis that TDD2 was authored against.
3. **Read the M1 plans in order:** `01-RESEARCH.md` → `01-01-PLAN.md` → `01-02-PLAN.md` → `01-03-PLAN.md`.
4. **Execute in the real SWT repo.** Clone `swt-labs/stop-wasting-tokens` separately, cut a `v3-foundation` branch, and execute the plans against the real codebase. This planning workspace stays read-only-ish during execution.

## Conflict resolution

If any file in `.vbw-planning/` disagrees with `TDD2.md`, **TDD2 wins**. The state files all carry an "Authoritative source: `TDD2.md`" pointer at the top. Discovered drift gets fixed in the same PR that exposes it.

## Why two repos?

This planning workspace is intentionally separate from the real SWT working repo because:

- The plans describe work that doesn't exist yet in `swt-labs/stop-wasting-tokens` — the workspace is design, not implementation, so it has no `package.json`, no CI, no tests of its own.
- Keeps TDD2.md addressable + diffable independently of code churn.
- Lets the executor (human or AI) clone *both* repos side-by-side: read here, edit there.
- v2.3.5 source is cloned under `.vbw-planning/research/swt-v2-source/` for read-only recon — it's `.gitignore`d here (4.3 MB, has its own `.git`).

## Authoring

Built with [VBW](https://github.com/swt-labs/vibe-better-with-claude-code-vbw) — the same methodology layer that v3 itself rewrites in Pi.

## License

The planning artifacts inherit MIT (same as v2). See `swt-labs/stop-wasting-tokens` for the canonical license.
