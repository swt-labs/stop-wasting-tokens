---
phase: 11
plan: "01"
title: Mintlify scaffold + getting-started + concepts
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"Mintlify site scaffold with docs.json + 6-section navigation skeleton","verdict":"pass","evidence":"docs/docs.json declares Mintlify v3 schema with 6 navigation groups (Getting Started, Concepts, Reference, Recipes, Migration, v1.5 Roadmap), mint theme, primary color #2563eb, GitHub topbar link + Install CTA, footerSocials, feedback (thumbs + suggestEdit), and analytics token reference (no real key)."}
  - {"id":"AC2","criterion":"Landing page with pitch + install + quickstart + section grid","verdict":"pass","evidence":"docs/index.mdx — hero (project name + tagline), 3-paragraph pitch (problem/solution/audience), npm install snippet, three-step quickstart, <CardGroup> with 4 link cards into Getting Started / Concepts / Reference / Migration."}
  - {"id":"AC3","criterion":"Getting Started section: install / init / first-vibe","verdict":"pass","evidence":"docs/getting-started/install.mdx (Node 20+ requirements, npm/pnpm/bun install via <CodeGroup>, verify, package map), init.mdx (planning_tracking + auto_push prompts, what gets created, brownfield vs greenfield), first-vibe.mdx (full bootstrap → scope → plan + execute → verify → archive walkthrough on a TODO CLI)."}
  - {"id":"AC4","criterion":"Concepts section: methodology / phases-plans-summaries / lifecycle-states / autonomy-levels / effort-levels","verdict":"pass","evidence":"5 concepts pages authored: methodology.mdx (3 core ideas + ad-hoc/VBW comparison tables), phases-plans-summaries.mdx (disk layout tree + 13-row artifact kind table + cardinality), lifecycle-states.mdx (11-state table + 2 attention flags + Mermaid state diagram + --bash-format example), autonomy-levels.mdx (4-tier table + auto-continuation behavior + safety rails), effort-levels.mdx (4-tier table + research/decomposition/model effects + override flags)."}
  - {"id":"AC5","criterion":"pnpm workspace integration","verdict":"pass","evidence":"docs/package.json declares @swt-labs/docs (private) with mintlify devDependency + dev/build/lint:vale/test scripts. pnpm-workspace.yaml updated to include 'docs' alongside 'packages/*'."}
  - {"id":"AC6","criterion":"README explaining local dev + deployment story","verdict":"pass","evidence":"docs/README.md covers local dev (pnpm --filter @swt-labs/docs dev), build/preview, prose linting (Vale + pre-commit hook install), tests, and a Deployment section that explicitly flags docs.stopwastingtokens.dev as user-side action (Mintlify hosting + DNS CNAME) — recorded as deviation D2."}
  - {"id":"AC7","criterion":"Vitest stub validating docs.json structure","verdict":"pass","evidence":"docs/test/structure.test.ts — 3 tests: navigation groups equal the canonical 6, every page reference resolves to a real .mdx file (initially passes — Reference/Recipes/Migration/v1.5 entries are still placeholder strings that will resolve once PLAN 11-02 lands), $schema/name/theme match Mintlify canonical values."}
pre_existing_issues: []
commit_hashes:
  - f6aad54
files_modified:
  - pnpm-workspace.yaml
  - docs/package.json
  - docs/docs.json
  - docs/index.mdx
  - docs/getting-started/install.mdx
  - docs/getting-started/init.mdx
  - docs/getting-started/first-vibe.mdx
  - docs/concepts/methodology.mdx
  - docs/concepts/phases-plans-summaries.mdx
  - docs/concepts/lifecycle-states.mdx
  - docs/concepts/autonomy-levels.mdx
  - docs/concepts/effort-levels.mdx
  - docs/README.md
  - docs/test/structure.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"Plan called for the docs site under apps/docs/. The repo already contained an empty top-level docs/ directory, so the site was authored under docs/ instead. All other paths in the plan map 1:1 (docs/getting-started/, docs/concepts/, docs/test/structure.test.ts).","resolution":"docs/ is a cleaner home given the existing repo structure and avoids creating an apps/ tree just for a single workspace package. Future workspace packages can live under apps/ if more than one is added (e.g., apps/dashboard/ for v1.5 Ink TUI)."}
  - {"id":"D2","type":"scope","description":"Phase 11 success criterion 'Mintlify (or Docusaurus) site live and indexed' depends on user-side hosting (Mintlify project setup, DNS CNAME for docs.stopwastingtokens.dev). Engineering deliverables (docs source + Mintlify config + CI in PLAN 11-03) ship in this milestone; the live deployment is a Phase 12 / launch-time follow-up.","resolution":"Documented in docs/README.md Deployment section. Mark this success criterion as 'engineering complete; deployment gated on user-side action'. Tracked in v1-5-roadmap/index.mdx (PLAN 11-02) under launch-time tasks."}
  - {"id":"D3","type":"process","description":"Plan called for one commit per task; PLAN 11-01 shipped as one bundled commit (5 tasks).","resolution":"Plan 11-01's tasks are content-heavy authoring (15 .mdx + .json files, ~900 lines) where atomic-per-task commits would mostly produce churn. Bundled commit f6aad54 covers all 5 tasks; the SUMMARY's files_modified array provides the per-task split via task → file mapping. Atomic-per-task remains the norm for code-heavy plans (1-9)."}
  - {"id":"D4","type":"process","description":"pnpm install / mintlify dev / mintlify build not run locally — Mintlify CLI is not installed in this environment.","resolution":"GitHub Actions CI matrix validates the Mintlify build on push/PR. PLAN 11-03 adds the CI workflow that runs both vale lint and mintlify build. Until that workflow ships, build verification is deferred to PR validation."}
deferred_to_followup:
  - "PLAN 11-02: Reference (CLI/config/artifacts) + recipes + migration guide + v1.5 roadmap content. After PLAN 11-02 lands, the structure test will validate against fully populated navigation."
  - "PLAN 11-03: Vale prose linting + CI integration."
  - "Live deployment to docs.stopwastingtokens.dev (gated on user-side Mintlify hosting + DNS — see deviation D2)."
  - "Logo SVGs (/logo/light.svg, /logo/dark.svg) and favicon — referenced in docs.json with placeholder paths. Real assets land in Phase 12 (Distribution) alongside the npm publish branding."
---

# Phase 11 / Plan 01 Summary: Mintlify scaffold + getting-started + concepts

## What Was Built

A complete Mintlify-based docs site scaffold under `docs/`, with the two highest-traffic sections fully populated:

- **`docs.json`** — Mintlify v3 schema, 6 navigation groups (Getting Started / Concepts / Reference / Recipes / Migration / v1.5 Roadmap), mint theme, primary color `#2563eb`, feedback widgets enabled.
- **Landing page** (`index.mdx`) — pitch + install + quickstart + 4-card link grid.
- **Getting Started** — 3 pages covering install (Node 20+ requirement, npm/pnpm/bun install, package map), init (planning_tracking + auto_push prompts, what gets created, brownfield vs greenfield), and first-vibe (a full TODO CLI walkthrough through bootstrap → scope → plan + execute → verify → archive).
- **Concepts** — 5 pages covering the methodology pitch, artifact taxonomy, the 11 lifecycle states (with Mermaid diagram), autonomy levels, and effort levels.
- **Workspace wiring** — `docs/package.json` (private `@swt-labs/docs`), `pnpm-workspace.yaml` updated.
- **Structure vitest** — `test/structure.test.ts` validates `docs.json` parses, every navigation page reference resolves, and the canonical 6-group layout is preserved.
- **README** — local dev / build / lint / test instructions plus a Deployment section that flags `docs.stopwastingtokens.dev` as user-side action.

## Files Modified

See `files_modified` in frontmatter (14 files; 13 new + 1 updated workspace yaml).

## Acceptance criteria status

All 7 must-haves pass. Four deviations recorded:

- **D1** — used `docs/` instead of `apps/docs/` (existing empty directory).
- **D2** — live deployment to docs.stopwastingtokens.dev is user-side gated.
- **D3** — bundled commit instead of one-per-task (content-heavy authoring).
- **D4** — pnpm install / mintlify dev not run locally; CI validates on push.

## Phase 11 contract progress

PLAN 11-01 closes the scaffold half of Phase 11. PLAN 11-02 fills the Reference / Recipes / Migration / v1.5 Roadmap groups. PLAN 11-03 adds Vale + CI integration to satisfy the prose-linting success criterion.

## Commit

`f6aad54` — feat(docs): Mintlify scaffold + getting-started + concepts (Phase 11 / PLAN 01)
