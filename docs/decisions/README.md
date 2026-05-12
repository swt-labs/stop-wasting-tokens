# Architecture Decision Records

This directory contains the 13 ADRs that anchor SWT v3's design. The canonical
template (Context / Decision / Consequences) follows TDD2 §18.4. Each ADR carries
YAML frontmatter so the index below — and tooling like Vale's `Verified-Status`
rule (TDD2 §15.9) — can read structured metadata without parsing prose.

## Lifecycle

- **Proposed** — drafted at TDD-time or in the ADR-introducing PR. The decision
  is documented; the code change that realises it has not landed.
- **Accepted** — promoted at the PR that ships the implementing code. The ADR's
  frontmatter gains an `accepted: YYYY-MM-DD` field; the `pr:` field points at
  the implementing PR; the body header line is rewritten to `**Status:** Accepted`.
- **Deferred** — recorded but not actionable yet. Re-evaluation criteria are
  written into the ADR's body so the deferral does not become permanent by default.

Vale enforces the `Status:` field on every ADR (TDD2 §15.9). The promotion step
is documented in the implementing PR's commit body so the audit trail is
self-contained.

## Status table (as of 2026-05-12, v3.0 structural close + LTS retraction)

|                          ADR                           | Title                                                          | Status         |  Decided   | PR                                 |
| :----------------------------------------------------: | :------------------------------------------------------------- | :------------- | :--------: | :--------------------------------- |
|          [001](./ADR-001-pi-sdk-adoption.md)           | Pi SDK as the runtime substrate                                | **Accepted**   | 2026-05-11 | M1 PR-02                           |
|     [002](./ADR-002-extension-result-protocol.md)      | Result protocol via Extension custom tool                      | **Accepted**   | 2026-05-11 | M1 PR-09                           |
|       [003](./ADR-003-quirks-json-over-shims.md)       | Provider quirks live in `quirks.json` applied via Pi Extension | **Accepted**   | 2026-05-11 | M1 PR-08                           |
|      [004](./ADR-004-cache-at-provider-layer.md)       | `cache_control` at provider-shim layer, not Pi-level           | **Accepted**   | 2026-05-11 | M1 PR-02                           |
|      [005](./ADR-005-delete-drivers-wholesale.md)      | Delete codex/claude-code/ollama drivers wholesale              | **Accepted**   | 2026-05-11 | M1 PR-05                           |
| [006](./ADR-006-cache-control-breakpoint-placement.md) | Cache-control breakpoint placement                             | **Accepted**   | 2026-05-12 | M4 PR-32                           |
|       [007](./ADR-007-budget-gate-semantics.md)        | Budget Gate thresholds (70% downgrade, 95% pause)              | **Accepted**   | 2026-05-12 | M4 PR-35                           |
|         [008](./ADR-008-worktree-per-task.md)          | Worktree-per-task model                                        | **Accepted**   | 2026-05-12 | M3 PR-22                           |
|  [009](./ADR-009-windows-worktree-path-discipline.md)  | Windows worktree path discipline                               | **Accepted**   | 2026-05-12 | M3 PR-30                           |
|        [010](./ADR-010-deterministic-builds.md)        | Deterministic builds (byte-identical from same commit)         | **Accepted**   | 2026-05-11 | M1 PR-11                           |
|   [011](./ADR-011-provider-matrix-cassettes-only.md)   | Provider-matrix CI runs on cassettes only                      | **Accepted**   | 2026-05-12 | M5 PR-44                           |
|        [012](./ADR-012-six-month-lts-policy.md)        | Six-month LTS for v2.3.x                                       | **Superseded** | 2026-05-12 | M6 PR-53 (Accepted → retracted)    |
|         [013](./ADR-013-docs-site-posture.md)          | No hosted documentation site at v3.0                           | **Deferred**   | 2026-05-11 | M6 PR-47                           |

**Tally** — 11 Accepted (001..011), 1 Deferred (013), 1 Superseded (012). ADR-012 was promoted to Accepted at M6 PR-53 and retracted same-day; see the Retraction section in ADR-012 for rationale.

## Promotion schedule

ADRs Proposed today promote to Accepted at the listed implementing PR. The promotion
schedule below is the planning view; the source of truth for "did promotion happen?"
is the `Status:` field on the ADR file itself.

| Promotion target   | Lands at                      | Trigger                                                       |
| :----------------- | :---------------------------- | :------------------------------------------------------------ |
| ADR-006 → Accepted | M4 PR-32                      | `buildPrompt()` ships with the cacheBreakpointIndex insertion |
| ADR-007 → Accepted | M4 PR-35                      | Budget Gate goes live with the 70%/95% thresholds             |
| ADR-008 → Accepted | M3 PR-22                      | First worktree-backed parallel dispatch                       |
| ADR-009 → Accepted | M3 PR-30                      | Windows path discipline + ESLint rule shipped                 |
| ADR-011 → Accepted | M5 PR-44                      | Provider matrix workflow exercises its cassettes              |
| ADR-013 → revisit  | when user count crosses ~1000 | Threshold trigger per ADR body                                |

ADR-012 was promoted Accepted at M6 PR-53 and superseded the same day; the retraction is recorded inline in the ADR file rather than in this schedule.

## How to add a new ADR

1. Use the next sequential number (currently the next free is 014). ADR numbers
   are never reused, never reordered — even when an ADR is rejected, its number
   is preserved with `Status: Rejected` (TDD2 §22.14 lifecycle note).
2. Copy `ADR-001-pi-sdk-adoption.md` as a starting structural template
   (frontmatter + Context / Decision / Consequences). The body is ≤ 500 words
   in the steady state; the introducing PR can run longer for ADRs that need
   to spell out the implementation surface (ADR-002, ADR-010).
3. Set `Status: Proposed` + the implementing PR identifier (`M? PR-??`).
4. Append a row to this README's status table.
5. The implementing PR promotes the ADR to Accepted in the same diff that
   ships the code (one PR carries both).
