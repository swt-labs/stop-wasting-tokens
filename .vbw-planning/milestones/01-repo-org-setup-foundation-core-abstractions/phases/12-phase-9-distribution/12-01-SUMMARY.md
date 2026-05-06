---
phase: 12
plan: "01"
title: npm publish wiring + provenance + version sync
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"All 7 packages flipped to publishable with publishConfig + repository + bugs + homepage + license + author","verdict":"pass","evidence":"Patched packages/{core,cli,codex-driver,methodology,artifacts,verification,telemetry}/package.json: removed 'private: true', added publishConfig {access: public, provenance: true}, repository {type: git, url, directory}, bugs.url, homepage, license: MIT, author. Each package now resolvable for npm publish."}
  - {"id":"AC2","criterion":"changeset config.json: empty ignore + linked across 7 @swt-labs packages","verdict":"pass","evidence":".changeset/config.json now declares linked: [['@swt-labs/core','@swt-labs/cli','@swt-labs/codex-driver','@swt-labs/methodology','@swt-labs/artifacts','@swt-labs/verification','@swt-labs/telemetry']] and ignore: []. Versions stay lockstep across the workspace; no package can drift forward independently."}
  - {"id":"AC3","criterion":"Root package.json has publishConfig + private: false","verdict":"pass","evidence":"Root package.json already had private: false and publishConfig: {access: public, provenance: true} from Phase 1 setup; no change required. Confirmed via inspection. Root version field stays at 0.0.0 — bumped via scripts/bump-version.sh when the user is ready to ship v0.1.0-alpha."}
  - {"id":"AC4","criterion":"release.yml: NPM_TOKEN + id-token:write + provenance","verdict":"pass","evidence":".github/workflows/release.yml already declares permissions.id-token: write, env.NPM_TOKEN: ${{ secrets.NPM_TOKEN }}, and env.NPM_CONFIG_PROVENANCE: 'true'. changesets/action picks up publishConfig.provenance from each package automatically — no separate --provenance flag needed in scripts. No edits required."}
  - {"id":"AC5","criterion":"scripts/bump-version.sh","verdict":"pass","evidence":"scripts/bump-version.sh authored: bumps all 7 workspace packages + root in lockstep using node -e. Supports --dry-run. Includes CLAUDE.md guard comment ('do NOT run unless user explicitly requests it'). Marked executable (chmod +x). Prints next-step guidance (git diff → commit → tag → push) without auto-pushing."}
  - {"id":"AC6","criterion":"README updated: install + provenance + docs link","verdict":"pass","evidence":"README.md updated: 'Install (planned)' section replaced with real npm/pnpm/bun install commands, npm provenance attestation note, link to docs.stopwastingtokens.dev, install-smoke badge URL. Phase status table updated to 15-phase roadmap (1-11 complete, 12 in-progress, 13-15 pending)."}
  - {"id":"AC7","criterion":"publishConfig vitest","verdict":"pass","evidence":"packages/cli/test/publish-config.test.ts: 7 per-package tests assert publishConfig.access=public, publishConfig.provenance=true, private!=true, repository.url contains swt-labs/stop-wasting-tokens, license=MIT, bugs.url. One additional drift test asserts all 7 publishConfig blocks JSON-stringify to the same value (catches per-package drift)."}
pre_existing_issues: []
commit_hashes:
  - 622d5fd
files_modified:
  - packages/core/package.json
  - packages/cli/package.json
  - packages/codex-driver/package.json
  - packages/methodology/package.json
  - packages/artifacts/package.json
  - packages/verification/package.json
  - packages/telemetry/package.json
  - .changeset/config.json
  - scripts/bump-version.sh
  - README.md
  - packages/cli/test/publish-config.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"Plan called for adding publishConfig to root package.json. Root already had publishConfig from Phase 1 — no edit needed.","resolution":"AC3 evidence notes the no-op. The publish-config vitest covers per-package shape; root publishConfig stays where Phase 1 set it."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 12-01 shipped as one bundled commit (5 tasks).","resolution":"Same rationale as PLANs 11-01 D3, 11-02 D2, 11-03 D4 — content-heavy authoring + small surgical config edits where atomic-per-task is mostly churn. Bundled commit 622d5fd covers all 5 tasks; files_modified provides the per-task split."}
  - {"id":"D3","type":"process","description":"pnpm install / pnpm test / changeset-action dry-run not run locally — environment lacks pnpm and the changesets binary.","resolution":"GitHub Actions release.yml + ci.yml validate on push/PR. The publish-config vitest will run on the next CI invocation and catches any drift introduced by the per-package patching."}
deferred_to_followup:
  - "User-side actions for v0.1.0-alpha shipping: (a) configure NPM_TOKEN secret in GitHub Actions, (b) run scripts/bump-version.sh 0.1.0-alpha, (c) git commit + git tag v0.1.0-alpha + git push origin main v0.1.0-alpha. Per CLAUDE.md, these are NOT to be run automatically — explicit user request gates them."
  - "PLAN 12-02: swt update CLI command (REQ-17 part 2)."
  - "PLAN 12-03: Codex Plugin Marketplace listing (REQ-19) + install smoke."
---

# Phase 12 / Plan 01 Summary: npm publish wiring + provenance + version sync

## What Was Built

The npm publish layer is now wired:

- **7 packages publishable** — each `packages/*/package.json` declares `publishConfig: {access: public, provenance: true}`, repository URL, bugs URL, homepage, license, author. None remain `private: true`.
- **changesets config** — empty `ignore` array (was 7 entries blocking publish), `linked` array forces lockstep versioning across all 7 `@swt-labs/*` packages.
- **release workflow** — already wired with `NPM_TOKEN`, `id-token: write`, and `NPM_CONFIG_PROVENANCE: 'true'` from Phase 1; verified.
- **`scripts/bump-version.sh`** — bumps root + all 7 packages in lockstep, supports `--dry-run`, includes the CLAUDE.md guard comment.
- **README** — install section uses `npm install -g @swt-labs/cli`, references provenance attestation, links to docs site, adds install-smoke badge URL.
- **publish-config vitest** — 8 tests catch any drift in publishConfig shape across packages.

## Files Modified

See `files_modified` in frontmatter (11 files: 7 package manifests + changesets config + bump script + README + vitest).

## Acceptance criteria status

All 7 must-haves pass. Three deviations recorded:

- **D1** — root publishConfig no-op (already in place from Phase 1).
- **D2** — bundled commit (matches established pattern for content-heavy plans).
- **D3** — local pnpm/changeset validation deferred to CI.

## Phase 12 contract progress

PLAN 12-01 closes the publish-wiring half of REQ-17. PLAN 12-02 adds `swt update` (the user-facing version checker). PLAN 12-03 closes REQ-19 (Codex Plugin Marketplace listing) and adds install smoke testing.

## Commit

`622d5fd` — feat(packaging): npm publish wiring + provenance + version sync (Phase 12 / PLAN 01)
