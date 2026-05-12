---
adr: 012
title: v2.3.x receives 6 months of security + critical-bug patches post-v3.0
status: Superseded
decided: 2026-05-12
pr: M1 PR-10 (drafted Proposed) → M6 PR-53 (promoted Accepted) → 2026-05-12 (retracted, same-day post-M6)
supersedes: TDD2 §17.5
related: ADR-005
---

# ADR-012 — v2.3.x receives 6 months of security + critical-bug patches post-v3.0

**Status:** Superseded — retracted 2026-05-12, same day as the M6 PR-53 promotion. v2.3.x receives no further patches. The `v2-archive` branch, the `release/v2.3-*` backport convention, the dedicated release workflow, and the Dependabot retarget have all been removed. npm continues to serve historical v2.3.x tarballs unchanged.

## Retraction (2026-05-12, same day post-M6)

The 6-month LTS commitment is retracted. Rationale:

- The maintainer decided that running two parallel engineering tracks (v3 forward work plus v2.3.x backports) is not justified against the realistic adoption profile of v2.3.x at the v3.0 release moment.
- `swt migrate --to=v3` (M6 PR-49) is out-of-place and idempotent. Operators who need to defer migration can pin to a specific v2.3.x patch on npm; the tarballs do not disappear.
- The retraction is documented same-day so the published surface (README, release notes, ADR registry) is internally consistent at the v3.0 mark.

Concrete effects of the retraction:

- `v2-archive` branch deleted from the remote on 2026-05-12.
- `.github/workflows/release.yml` (the v2-only release workflow) deleted.
- `.github/dependabot.yml` (Dependabot retargeted to `v2-archive`) deleted.
- `.github/workflows/{ci,codeql,vale}.yml` trigger blocks no longer include `v2-archive` or `release/v2.3-*` branches.
- `docs/operations/lts-policy.md` (the operator-facing reference) deleted.
- README + release notes + migration guide no longer advertise a 6-month support window.

The original ADR body is preserved verbatim below as a historical record of the decision that was made and same-day reversed.

## Context (historical)

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

Option 3 was chosen at promotion to balance user obligation with engineering
scope. Same-day reflection moved the decision back to Option 1.

## Decision (historical — superseded)

v2.3.x was to enter LTS on the v3.0.0 release date for 6 calendar months
with the following SLAs:

- **Security** (CVE, credential leak, RCE): 7-day backport target.
- **Data-loss / install-breaking**: 14-day backport target.
- **Regression**: 30-day backport target.
- **Features / enhancements**: not addressed.

After 6 months: final patch release, EOL announcement, branch read-only.

Backports were to route through `release/v2.3-*` branches into `v2-archive`.

## Consequences (historical — superseded)

Easier (at promotion time):

- Maintenance scope bounded and visible.
- Dual-track sized: 6 months × historical v2.3.x cadence ≈ 8 patch releases worst case.
- After EOL, the v3 team works on v3 only.

Harder (at promotion time):

- 6 months of two-track engineering with per-fix port/skip/backport decisions.
- Backport-review staffing burden.
- Users unable to migrate by month 6 lose support.

The "Harder" column was the trigger for the same-day retraction.

## Validation (historical — no longer in effect)

The Validation section originally documented three operationalization layers:

1. Migration path (M6 PR-49) — `swt migrate --to=v3`. **Still in effect** — independent of the LTS commitment.
2. Operator-facing reference (M6 PR-53) — `docs/operations/lts-policy.md`. **Removed** as part of the retraction.
3. Infrastructure (`v2-archive` branch + Dependabot retarget + `release/v2.3-*` convention). **Removed** as part of the retraction.

Layer 1 stands on its own. Layers 2 + 3 are gone.

## See also

- [ADR-005 — Delete legacy drivers wholesale](ADR-005-delete-drivers-wholesale.md) — the migration story is the surviving counterpart to this retracted policy.
- [`docs/cli/verbs/migrate.md`](../cli/verbs/migrate.md) — the v2 → v3 migration verb that remains the actual support path for v2.x users.
