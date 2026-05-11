---
adr: 013
title: No hosted documentation site at v3.0; in-tree docs/ is sufficient
status: Deferred
decided: 2026-05-11
pr: M6 PR-47
supersedes: TDD2 §18.6
related: ADR-005, ADR-012
---

# ADR-013 — No hosted documentation site at v3.0; in-tree docs/ is sufficient

**Status:** Deferred (revisit when the user-count threshold crosses ~1000;
M6 PR-47 ships v3.0 with the in-tree posture)

## Context

A hosted documentation site (MkDocs, Docusaurus, Mintlify, GitHub Pages,
ReadTheDocs, etc.) adds:

- Infrastructure cost (build runner minutes + hosting bill).
- Deployment surface (one more thing the release pipeline manages, one
  more thing that can be broken by an unrelated change).
- Maintenance overhead (theme upgrades, search-index rebuilds, broken-link
  reports, separate-from-code review cycles).
- A second source of truth that drifts from the in-tree markdown unless
  rigorously generated from it.

At v3.0's expected user scale (low thousands; carry-forward from v2.x npm
download stats + the migration cohort), GitHub-rendered markdown is the
path of least friction. Users can read `docs/` directly in the browser;
search via GitHub code search; link-to-line for issue discussions. The
benefit of a polished site is real but small at this scale.

Two failure modes for shipping the site now:

1. **Premature investment** — building the site burns M6 PR time that's
   better spent on the `swt migrate --to=v3` script and the public
   benchmark suite.
2. **Drift** — hand-maintained sites diverge from `docs/` over time;
   automated generators are themselves a maintenance surface.

The decision is "not now," not "not ever." Re-evaluation criteria are
explicit so the deferral doesn't become permanent by default.

## Decision

v3.0 ships with `docs/` in-tree only. No hosted site. No build step that
generates a site as part of release.

Re-evaluate when one of:

- **User count crosses ~1000** active monthly users (npm download stats
  + dashboard telemetry once opt-in deployed in M4).
- **Deep linking demand surfaces** in issue discussions (search "docs site"
  / "documentation site" labels reaches 5+ issues).
- **A contributor volunteers** to own the hosted-site infrastructure
  end-to-end (build, deploy, maintain) — not just the initial setup.

When re-evaluation triggers, the site is **auto-generated** from `docs/`
(not hand-maintained). The single-source-of-truth invariant stays in
place: `docs/` is authoritative; the site is a downstream artifact.

Candidate generators (when re-evaluation triggers): Docusaurus or MkDocs
Material — both Markdown-native with first-class search. Mintlify rejected
(proprietary format).

## Consequences

Easier:
- One source of truth. No build step in the release pipeline. No hosting
  bill.
- Contributors don't need to learn a site generator to edit docs.
- M6 PR time stays focused on migration script + benchmark + v3.0 launch.

Harder:
- Deep linking is weaker. Mitigation: GitHub's permalink anchors;
  `docs/README.md` maintains a topical index.
- Search is weaker — GitHub code search isn't great for prose.
  Mitigation: in-tree topical organisation per TDD2 §18.1.
- Users may read "no docs site" as "no docs." Mitigation: root README links
  prominently to `docs/README.md`; the M6 PR-47 post-install message
  points to docs/ in the package.
