# ADR style guide

Conventions for `docs/decisions/ADR-NNN-*.md` per Plan 06-01 PR-52. Per TDD2 §22.

> **Audience:** anyone authoring or promoting an ADR.
> **Canonical reference:** the 11 Accepted ADRs (001-011) in this directory are the working examples.

## File naming

```
docs/decisions/ADR-NNN-{kebab-case-title}.md
```

- `NNN` — zero-padded 3-digit identifier, monotonically increasing. Never reused.
- `{kebab-case-title}` — short hyphenated slug capturing the core decision (e.g., `pi-sdk-adoption`, `worktree-per-task`, `provider-matrix-cassettes-only`).
- Filename slug matches the body's title (the H1).

## Frontmatter

Every ADR starts with a YAML frontmatter block:

```yaml
---
adr: NNN
title: <human-readable title>
status: <Proposed | Accepted | Deferred | Superseded>
decided: YYYY-MM-DD
pr: <PR identifier> (drafted Proposed) → <PR identifier> (promoted Accepted)
supersedes: <TDD2 §X.Y reference or prior ADR-NNN>
related: <comma-separated ADR-NNN references>
---
```

Field rules:

- `adr` — integer matching the file's `NNN`.
- `title` — same as the H1 heading text.
- `status` — one of the four lifecycle values (see below).
- `decided` — ISO date of the last status change. Updated when the ADR transitions.
- `pr` — single PR ID for ADRs that ship with their implementation; two-stage `drafted → promoted` form for ADRs that draft Proposed at one PR and promote Accepted at a later one.
- `supersedes` — optional. Points at the TDD2 section the ADR replaces, or at the prior ADR being superseded.
- `related` — optional. Comma-separated `ADR-NNN` IDs the reader should cross-reference.

## Status lifecycle

ADRs progress through four states:

| Status         | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Proposed**   | The decision is documented but not yet enforced by code/tests. PR-N drafts as Proposed; promotion is gated.        |
| **Accepted**   | The decision is in force. Implementation has shipped + tests validate it. The `Validation` section is required.    |
| **Deferred**   | The decision is intentionally postponed (e.g., out of scope for the current release window). Revisit date in body. |
| **Superseded** | A later ADR has replaced this one. Body links forward to the successor.                                            |

A `Proposed → Accepted` transition is the most common path. `Proposed → Deferred` happens when scope changes. `Accepted → Superseded` happens when a later ADR overrides the decision (rare; document the rationale in the superseding ADR).

## Body structure

Every ADR has these sections in order:

1. **Title** — H1 matching `title` frontmatter.
2. **Status line** — single line beneath the H1: `**Status:** <Status>` with optional commit/PR reference.
3. **Context** — what problem prompted the decision. Concrete signals (failure modes, costs, regressions) over abstract goals.
4. **Decision** — the chosen rule. Stated as a directive, not as an option. Tables welcome for enumerating cases.
5. **Consequences** — split into "Easier" + "Harder" subsections. Honest about trade-offs.
6. **Validation** — required for Accepted ADRs. Lists the implementation layers + tests that enforce the decision. The Validation section is the canonical answer to "how do we know this ADR is still in effect?"
7. **Lifecycle** (optional) — notes on when the ADR was drafted vs promoted vs superseded.

## Voice + style

- **Active voice.** "The dispatcher routes" not "is routed by the dispatcher".
- **Present tense.** "ADR-X requires" not "ADR-X will require". The ADR exists now; the rule applies now.
- **Concrete over abstract.** "1024-token Anthropic minimum" beats "sufficient cache prefix size".
- **No marketing.** "Vendor-neutral" is a structural claim, not a feature; describe the mechanism, not the benefit.
- **Cite the test.** When an Accepted ADR has Validation tests, name the file path. `packages/orchestration/test/prompt-builder.determinism.test.ts` is more useful than "determinism is tested".
- **One decision per ADR.** When a single ADR covers multiple decisions, split it.

## Prose linting

Run `vale --config=.vale.ini docs/decisions/` locally to surface passive voice + wordiness + Microsoft-style clarity nits. ADRs are operator-facing technical writing — Vale's suggestion-level alerts catch the most common drift without failing CI.

## Examples

Refer to the 11 Accepted ADRs in this directory as canonical examples:

- **ADR-001** (Pi SDK adoption) — frontmatter + validation pattern
- **ADR-006** (cache-control breakpoint placement) — 4-layer Validation section
- **ADR-007** (Budget Gate semantics) — concrete thresholds + state-machine table
- **ADR-008** (worktree-per-task) — structural + ops + chaos validation layers
- **ADR-009** (Windows path discipline) — three-rule decision + cross-OS test references
- **ADR-011** (provider-matrix via cassettes) — multi-stage lifecycle (drafted Proposed → promoted Accepted)

## Promotion checklist

When promoting a Proposed ADR to Accepted:

- [ ] Flip `status: Proposed` → `status: Accepted` in frontmatter
- [ ] Update `decided` to today's ISO date
- [ ] Update `pr` field to include the promoting PR
- [ ] Update the Status line beneath the H1
- [ ] Add a `## Validation` section listing the implementation layers + tests
- [ ] Cross-reference the promoting PR in `CHANGELOG.md`
- [ ] Update `.vbw-planning/v3-tracking.md`'s ADRs-touched column

The PR that promotes the ADR ships these steps together.

## See also

- [`README.md`](README.md) — ADR index
- [TDD2 §22](../../TDD2.md) — design-document home for the ADR registry
- [`.vale.ini`](../../.vale.ini) — prose-linter config
