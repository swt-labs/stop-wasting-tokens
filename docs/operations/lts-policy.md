# Operations — v2.3.x LTS policy

Operator-facing reference for the v2.3.x LTS window per ADR-012 + Plan 06-01 PR-53.

> **Status (M6 PR-53, 2026-05-12):** ADR-012 Accepted. The 6-month LTS clock starts when v3.0.0 ships to npm (user-driven release operation).
>
> **Canonical reference:** [ADR-012 — v2.3.x receives 6 months of security + critical-bug patches post-v3.0](../decisions/ADR-012-six-month-lts-policy.md).

## What v2.3.x users get

v2.3.x enters LTS on the v3.0.0 npm release date and stays in LTS for **6 calendar months**. During the LTS window, the v3 maintainers backport fixes for three severity tiers:

| Severity                         | Examples                                                 | Backport SLA    |
| -------------------------------- | -------------------------------------------------------- | --------------- |
| **Security**                     | CVE-tagged vulnerability, credential leak, RCE           | 7 days          |
| **Data-loss / install-breaking** | Filesystem corruption, install failure on a supported OS | 14 days         |
| **Regression**                   | A v2.3.5-released feature stops working                  | 30 days         |
| **Features / enhancements**      | New verbs, new providers, new dashboard panels           | _not addressed_ |

The SLAs are targets from public disclosure (security) or operator-filed bug report (data-loss / regression) to the first npm release on the v2-archive line. They aren't guarantees of a CI cycle's worth of testing — backports prioritize speed to mitigation over breadth of coverage.

## What v2.3.x users don't get

- **New features.** All new development goes to v3. The v2 line is fix-only.
- **Dependency major-version bumps.** Dependabot retargets to `v2-archive` so transitive deps stay current, but no major-version upgrades happen on the LTS line.
- **New providers.** Pi-backed providers (OpenRouter, Google, Bedrock, expanded Anthropic + OpenAI catalogues) are v3-only.
- **Worktree dispatcher, Budget Gate, cache-control wiring, TPAC reporting, public benchmark.** All v3 capabilities. v2.3.x continues to ship the v2 capability set verbatim.

## EOL date

The EOL date is **v3.0.0 release date + 6 calendar months**. After EOL:

- Final patch release cut on the v2-archive line.
- `v2-archive` branch stays on GitHub (read-only).
- npm continues to serve historical tarballs at their existing versions.
- The README on `main` is updated with the EOL date + a pointer to v3.

Operators who can't migrate by EOL are out of support. The migration guide ([`docs/operations/migrating-from-v2.md`](migrating-from-v2.md)) + `swt migrate --to=v3` (M6 PR-49) cover the typical case in a single session.

## How to report an issue against v2.3.x

1. **Security (CVE-tagged):** open a private security advisory at `https://github.com/swt-labs/stop-wasting-tokens/security/advisories`. The 7-day SLA starts when the advisory is acknowledged.
2. **Data-loss / install-breaking:** open a GitHub issue with the `lts-v2` label + the `data-loss` or `install-breaking` label. The 14-day SLA starts when the issue is triaged.
3. **Regression:** open a GitHub issue with the `lts-v2` + `regression` labels + a minimal reproduction. The 30-day SLA starts when the regression is reproduced on a maintainer's machine.

For all three, include:

- The v2.3.x patch version you're on (`swt version`).
- Your Node version + OS.
- The relevant `.swt-planning/STATE.md` excerpt (or as much as you can share).
- A minimal reproduction if applicable.

## Backport routing

Backports flow through short-lived `release/v2.3-*` branches:

```
main (v3)               release/v2.3-001       v2-archive
   │                            │                   │
   ●  fix lands in v3           │                   │
   │                            │                   │
   │  cherry-pick + retest      │                   │
   │  ──────────────────────────●                   │
   │                            │                   │
   │                            │  merge after CI   │
   │                            ●──────────────────●  v2.3.6 published
   │                            │                   │
   │                            │  (deleted)        │
```

The `release/v2.3-*` branches are short-lived: created when a backport starts, deleted after the v2.3.x patch ships. The `v2-archive` branch carries the cumulative LTS history.

Dependabot targets `v2-archive` per [`.github/dependabot.yml`](../../.github/dependabot.yml) so transitive-dep security updates keep flowing without manual intervention. The Dependabot PRs cut release-v2.3-\* branches for each batch.

## Migration is preferred over LTS

The LTS exists as a safety net for users who genuinely can't migrate on day one. For everyone else, migrating to v3 within the LTS window is preferred because:

- **You get fixes faster.** v3 lands fixes immediately; v2.x lands them via the backport SLA.
- **You get features.** The Budget Gate, multi-provider routing, cache discipline, and per-task TPAC measurement are real wins.
- **The migration is mostly mechanical.** `swt migrate --to=v3` handles the schema rename; methodology is preserved verbatim.
- **The runtime substrate is more durable.** Pi's 25+ provider catalogue means provider-specific bugs (which were a frequent v2 churn source) are mostly Pi's problem now.

If you can migrate within the LTS window, do it. The LTS exists for the cases you can't.

## See also

- **[ADR-012](../decisions/ADR-012-six-month-lts-policy.md)** — the canonical policy decision.
- **[`docs/operations/migrating-from-v2.md`](migrating-from-v2.md)** — the migration guide.
- **[`docs/cli/verbs/migrate.md`](../cli/verbs/migrate.md)** — `swt migrate --to=v3` reference.
- **TDD2 §17.5** — original LTS spec.
