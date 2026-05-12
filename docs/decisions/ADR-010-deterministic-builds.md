---
adr: 010
title: Build outputs are byte-identical from the same commit
status: Accepted
decided: 2026-05-11
accepted: 2026-05-11
pr: M1 PR-11
supersedes: TDD2 §15.2, §17.4
related: ADR-001, ADR-011
---

# ADR-010 — Build outputs are byte-identical from the same commit

**Status:** Accepted (promoted at M1 PR-11 — the `reproducible-build` CI job
shipped alongside the workflow scaffolds, and the build pipeline was audited
for time-dependent output during the same change)

## Context

v3 publishes to npm with provenance attestations (the `--provenance` flag in
`publishConfig`). Provenance is only meaningful if a third party can fetch
the source commit and reproduce the published tarball byte-for-byte. Two
classes of nondeterminism break that promise:

1. **Time-dependent output.** `Date.now()`, `process.hrtime()`, or build-tool
   banners stamping the build date into the output. Two runs of the same
   build at different wall-clock times produce different bytes.
2. **Source-of-truth drift.** A `pnpm install` against an unfrozen lockfile
   resolves to slightly different transitive versions on different days;
   tsup's output depends on the input version graph; the tarball differs.

Additionally, supply-chain hygiene matters: any tool we adopt becomes part
of the trust surface. Reproducibility is the audit knob — if a downstream
user can't reproduce the bytes, they can't verify what they're running.

## Decision

Three concrete requirements + one CI enforcement mechanism:

1. **No time-stamping in build outputs.** No `Date.now()` / `process.hrtime()`
   in shipped bundles. tsup `banner` / `footer` customised to omit `--banner
"// Built at: $(date)"` patterns. If a tool insists on time-stamping (rare;
   tsup itself doesn't), wrap it in a deterministic shim or replace it.
2. **Lockfile-frozen installs in CI.** Every CI job runs `pnpm install
--frozen-lockfile`. Local development can drift; CI does not.
3. **Reproducible-build CI job.** `.github/workflows/ci.yml` carries a
   `reproducible-build` job that runs `pnpm build` twice, moves the first
   `dist/` aside, runs again, and `diff -r dist-first dist`. Non-empty
   diff fails the job; the first-build artifact is uploaded for inspection.
4. **Job gating.** The reproducible-build job runs on push-to-main only
   (push events with `branches: [main]` filter). PR builds get the
   standard build matrix; main-bound merges additionally get the
   reproducibility check.

ADR-010 promotes from Proposed → Accepted at M1 PR-11 — the PR that adds
the CI job AND audits the build pipeline for nondeterminism. After that
merge, reproducibility is enforced; subsequent PRs that reintroduce
time-stamps fail the gate.

## Consequences

Easier:

- Provenance attestations are trustworthy; users (and downstream auditors)
  can independently verify that the published npm tarball matches the
  source commit at the tagged SHA.
- Bug-bisect becomes reliable — `git bisect run "pnpm build && diff -r
dist1 dist2"` works as a determinism regression check.
- npm provenance integrates cleanly with the `release.yml` workflow (TDD2
  §17.4) without additional glue.

Harder:

- Every new tool we adopt must be audited for nondeterminism. The
  contributor checklist gains an audit step.
- Date-stamped output (a legitimate developer convenience) requires a
  feature flag — `SWT_BUILD_TIMESTAMP` env var off in production.
- The CI job adds ~90s to push-to-main; one extra build per merge.
