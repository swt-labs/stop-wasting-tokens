---
adr: 012
title: v2.3.x receives 6 months of security + critical-bug patches post-v3.0
status: Proposed
decided: 2026-05-11
pr: M6 PR-53
supersedes: TDD2 §17.5
related: ADR-005
---

# ADR-012 — v2.3.x receives 6 months of security + critical-bug patches post-v3.0

**Status:** Proposed (promotes to Accepted when M6 PR-53 lands the LTS branch cut)

## Context

v3 is a runtime-layer rewrite (Codex/Claude-Code/Ollama drivers → Pi);
methodology is preserved, but the dependency surface changes substantially.
Some v2.x users will not be able to migrate on day one:

- Air-gapped environments that can't pull `@earendil-works/pi-coding-agent`.
- Teams with regulatory review cycles for new dependencies.
- Users on providers Pi doesn't yet support natively (rare with Pi's 25+
  provider catalogue, but possible).
- Forks with significant local divergence.

Three positions are tenable:

1. **No LTS** — v3.0 ships, v2.x stops receiving patches immediately.
   Users migrate or accept the security debt.
2. **Unbounded LTS** — v2.x keeps getting patches as long as anyone uses it.
   Two-track engineering forever; v3 work slows.
3. **Time-bounded LTS** — v2.x receives a defined window of patches with
   explicit SLAs; window has a hard end date and an explicit EOL.

Option 3 balances user obligation with engineering scope. The duration
matters less than the explicit bound — anything from 3 to 9 months is
reasonable; 6 months is the chosen middle ground.

## Decision

v2.3.x enters LTS on the v3.0.0 release date for 6 calendar months. SLAs:

- **Security** (CVE, credential leak, RCE): 7-day backport target.
- **Data-loss / install-breaking** (filesystem corruption, install failure
  on a supported OS): 14-day backport target.
- **Regression** (a v2.3.5-released feature stops working): 30-day backport target.
- **Features / enhancements**: not addressed. v2.x users get fixes only.

After 6 months:

- Final patch release on the v2-archive branch.
- v2-archive tag preserved (already in place from the repository pivot).
- README on `main` updated with EOL date + pointer to v3.
- The `v2-archive` branch stays on GitHub (read-only); npm continues to
  serve historical tarballs.

Backports route through `release/v2.3-*` branches (per the repository pivot
on 2026-05-11). The `v2-archive` branch carries the v2.3.5 source verbatim
and receives patches only via these release branches. The Dependabot retarget
to `v2-archive` (already in place) keeps the LTS branch on supported
transitive deps without disturbing main.

## Consequences

Easier:

- Maintenance scope bounded and visible. Users have a clear deadline;
  security obligations are precise.
- Dual-track sized: 6 months × historical v2.3.x cadence ≈ 8 patch releases
  worst case.
- After EOL, the v3 team works on v3 only.

Harder:

- 6 months of two-track engineering. Every v3 fix touching shared
  methodology needs a port/skip/backport decision.
- The v3 team must staff backport reviews. Mitigation: batched release cuts.
- Users who can't migrate by month 6 are out of support. Mitigation: the
  migration guide + `swt migrate --to=v3` script land in M6.
