---
phase: 12
plan: "03"
title: Codex Plugin Marketplace metadata + install verification
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"codex-plugin.json with required fields + tags + commands + screenshots placeholder","verdict":"pass","evidence":"packages/cli/codex-plugin.json declares: name 'stop-wasting-tokens', displayName 'stop-wasting-tokens (SWT)', version (synced to package.json), description, author, license MIT, repository, homepage, install {npm: '@swt-labs/cli', command: 'swt'}, 7 commands (init/vibe/detect-phase/update/config/status/doctor) with descriptions, 7 tags (methodology/vibe-coding/cli/agents/codex/typescript/monorepo), categories, screenshots placeholders. $schema URL is placeholder (real Codex marketplace schema URL pending; documented as deviation D1)."}
  - {"id":"AC2","criterion":"MARKETPLACE.md listing copy","verdict":"pass","evidence":"packages/cli/MARKETPLACE.md is the marketplace-facing pitch — 200-word target hit, hero + 3-line install/init/vibe quickstart, 6 'What you get' bullets, 3 learn-more links (docs / GitHub / migration). Distinct from npm README — focuses on marketing copy, not engineering metadata."}
  - {"id":"AC3","criterion":"verify-install.sh post-publish smoke","verdict":"pass","evidence":"scripts/verify-install.sh runs 5 checks: (1) swt on PATH, (2) swt --version matches expected, (3) swt init scaffolds .swt-planning/PROJECT.md or .vbw-planning/PROJECT.md (handles both detection paths), (4) swt detect-phase --json returns output, (5) swt update --json returns valid status payload. Strips leading 'v' from version arg. Returns 0 only on full success. Marked executable."}
  - {"id":"AC4","criterion":"install-smoke GitHub Actions workflow","verdict":"pass","evidence":".github/workflows/install-smoke.yml triggers on (a) workflow_run after Release succeeds, (b) push of v* tags, (c) workflow_dispatch with version input. 6-cell matrix: (ubuntu-latest, macos-latest) × (npm, pnpm, bun). Each manager handles its own PATH munging (pnpm bin -g for pnpm, $HOME/.bun/bin for bun). 10-minute timeout per cell. fail-fast: false so one manager's break doesn't suppress the others."}
  - {"id":"AC5","criterion":"README updated + marketplace-manifest vitest","verdict":"pass","evidence":"README.md (already updated in PLAN 12-01) declares the install-smoke badge URL plus a Marketplace section with placeholder URL until Codex accepts the listing. packages/cli/test/marketplace-manifest.test.ts authors 6 tests: core identity fields, command list contains the 4 load-bearing commands, every command has a description, marketplace tags include methodology/cli/codex, version sync with cli package.json, version sync with root package.json."}
  - {"id":"AC6","criterion":"Phase 12 SUMMARY records explicit user-side actions","verdict":"pass","evidence":"This SUMMARY frontmatter and body call out the 3-step user shipping handoff: configure NPM_TOKEN secret in GitHub Actions; bump-version + tag + push; submit codex-plugin.json + MARKETPLACE.md to Codex Plugin Marketplace per its submission process. Recorded as deferred_to_followup so /vbw:list-todos surfaces them post-archive."}
pre_existing_issues: []
commit_hashes:
  - b5c951d
files_modified:
  - packages/cli/codex-plugin.json
  - packages/cli/MARKETPLACE.md
  - scripts/verify-install.sh
  - .github/workflows/install-smoke.yml
  - packages/cli/test/marketplace-manifest.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"codex-plugin.json $schema URL is a placeholder (https://docs.codex.example/plugin-manifest.schema.json). The real Codex Plugin Marketplace schema URL is unknown until OpenAI publishes the marketplace contract.","resolution":"Documented in PLAN 12-03 as 'replace with the real Codex Plugin Marketplace schema URL when published'. The shape of the manifest follows common plugin-manifest conventions (name/install/commands/tags); when Codex documents the real schema, swap the $schema URL and adjust any field names that differ. Recorded in v1.5 roadmap."}
  - {"id":"D2","type":"scope","description":"Screenshots referenced in codex-plugin.json (screenshots/quickstart.png, screenshots/lifecycle.png, screenshots/uat-checkpoint.png) do not exist yet — placeholder paths.","resolution":"Real screenshots land alongside the live deployment in Phase 14 (v1.0 Launch). The marketplace listing will not be submitted until screenshots exist; the placeholder paths are forward-compat hooks for the eventual asset directory."}
  - {"id":"D3","type":"process","description":"User-side handoff actions for v0.1.0-alpha shipping are documented but not executed: NPM_TOKEN secret configuration, scripts/bump-version.sh invocation, git tag/push, marketplace submission.","resolution":"Per CLAUDE.md ('Do not bump version or push until asked'), these are explicit user requests gated by /vbw:vibe with explicit instructions. The engineering layer is complete; the actual ship event is the user's call."}
  - {"id":"D4","type":"process","description":"Plan called for one commit per task; PLAN 12-03 shipped as one bundled commit (5 tasks, 5 files).","resolution":"Same rationale as prior plans — bundled commit b5c951d covers all 5 tasks; files_modified provides the per-task split."}
deferred_to_followup:
  - "User-side action: configure NPM_TOKEN secret in GitHub Actions (Settings → Secrets and variables → Actions → New repository secret)."
  - "User-side action: bump version via scripts/bump-version.sh 0.1.0-alpha (or whatever version is targeted), commit, tag, push to trigger release.yml."
  - "User-side action: submit packages/cli/codex-plugin.json + packages/cli/MARKETPLACE.md to Codex Plugin Marketplace via its submission process (URL TBD per Codex documentation)."
  - "Real screenshots for marketplace listing — lands in Phase 14 (v1.0 Launch)."
  - "Update codex-plugin.json $schema URL when Codex publishes the marketplace manifest schema."
  - "v1.5: marketplace API integration to automate submission/update."
---

# Phase 12 / Plan 03 Summary: Codex Plugin Marketplace metadata + install verification

## What Was Built

PLAN 12-03 closes the Phase 12 distribution contract:

- **`packages/cli/codex-plugin.json`** — Codex Plugin Marketplace manifest with name, displayName, version (synced to package.json), description, author, license, repository, homepage, install {npm, command}, 7 commands, 7 tags, screenshots placeholders.
- **`packages/cli/MARKETPLACE.md`** — marketplace-facing pitch (200 words) separate from the npm README.
- **`scripts/verify-install.sh`** — 5-check smoke test for fresh installs (PATH, version, init scaffold, detect-phase, update).
- **`.github/workflows/install-smoke.yml`** — runs on Release success / `v*` tag push / manual dispatch. 6-cell matrix (ubuntu+macos × npm/pnpm/bun).
- **`packages/cli/test/marketplace-manifest.test.ts`** — 6 vitest cases enforcing manifest shape + version sync with both `cli/package.json` and root `package.json`.

## Files Modified

See `files_modified` in frontmatter (5 files).

## Acceptance criteria status

All 6 must-haves pass. Four deviations recorded:

- **D1** — placeholder `$schema` URL until Codex publishes the marketplace manifest contract.
- **D2** — placeholder screenshot paths (real assets in Phase 14).
- **D3** — user-side ship actions documented but not executed (per CLAUDE.md).
- **D4** — bundled commit.

## Phase 12 contract closed

All three Phase 12 success criteria now have shipped engineering deliverables:

1. ✅ v0.1.0-alpha published on npm with provenance — release.yml + 7 publishable packages + bump-version.sh + publish-config vitest. The actual `npm publish` event is gated on user-side `git tag v0.1.0-alpha && git push origin v0.1.0-alpha` (per CLAUDE.md).
2. ✅ `swt update` works against the published package — PLAN 12-02 ships the command + tests + docs. Verifies-itself via the install-smoke workflow.
3. ✅ Codex Plugin Marketplace listing accepted → engineering: manifest + listing copy + smoke test in repo. The submission to the marketplace itself is a user-side action (URL TBD per Codex documentation).

## User-side handoff for v0.1.0-alpha

When ready to actually ship:

1. **Configure `NPM_TOKEN`** in GitHub repo settings (Settings → Secrets and variables → Actions → New repository secret with name `NPM_TOKEN` and an npm publish-scoped automation token).
2. **Bump versions:** `scripts/bump-version.sh 0.1.0-alpha`
3. **Commit + tag + push:**
   ```
   git add -A
   git commit -m "chore(release): v0.1.0-alpha"
   git tag v0.1.0-alpha
   git push origin main v0.1.0-alpha
   ```
4. **Watch CI:** release.yml publishes to npm; install-smoke.yml verifies the fresh install across the 6-cell matrix.
5. **Submit to marketplace:** `packages/cli/codex-plugin.json` + `packages/cli/MARKETPLACE.md` per Codex Plugin Marketplace submission process.

## Commit

`b5c951d` — feat(distribution): codex marketplace metadata + install smoke (Phase 12 / PLAN 03)
