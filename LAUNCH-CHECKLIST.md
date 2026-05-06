# Launch checklist — v1.0

Use this checklist on launch day. Items are ordered: pre-flight first, then publish, then announce, then monitor.

Every checkbox here corresponds to a user-side action that an SWT phase deferred to the launch event. The originating PLAN/SUMMARY is referenced where useful.

## Pre-flight (do once, days before launch)

- [ ] Configure `NPM_TOKEN` secret in GitHub Actions (Settings → Secrets and variables → Actions → New repository secret) — Phase 12 / PLAN 01 deferral
- [ ] Verify `release.yml` workflow runs cleanly on a draft tag (e.g., `v0.0.0-test`, then delete the tag)
- [ ] Confirm `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` is green on a fresh clone
- [ ] Review [`SECURITY-REVIEW-v1.0.md`](SECURITY-REVIEW-v1.0.md) — every PASS row reflects current code; the one FOLLOW-UP (CoC contact email) is the next checkbox
- [ ] Replace placeholder URLs across the repo (per the "Placeholder URL inventory" section of `SECURITY-REVIEW-v1.0.md`):
  - [ ] `docs.stopwastingtokens.dev` → real Mintlify hosting URL (after DNS + Mintlify setup, see next two checkboxes)
  - [ ] `discord.gg/swt-labs-beta` → real Discord invite (after Discord setup)
  - [ ] `docs.codex.example` → real Codex Plugin Marketplace schema URL
  - [ ] `conduct@stopwastingtokens.dev` → real Code of Conduct contact email
- [ ] Set up Mintlify hosting + DNS CNAME for `docs.stopwastingtokens.dev` — Phase 11 / PLAN 01 deferral D2
- [ ] Create Discord server with `CODE_OF_CONDUCT.md` pinned + 4 channels (`#general`, `#friction`, `#help`, `#wins`) — Phase 13 / PLAN 02 user-side action
- [ ] Enable GitHub Discussions in repo settings (Settings → Features → Discussions) so the templates from `.github/DISCUSSION_TEMPLATE/` take effect

## npm publish (the actual ship)

- [ ] `scripts/bump-version.sh 1.0.0 --dry-run` — review what will change
- [ ] `scripts/bump-version.sh 1.0.0` — apply (bumps root + 7 packages in lockstep)
- [ ] `git diff` — sanity check the version bumps land where expected
- [ ] `git add -A && git commit -m "chore(release): v1.0.0"`
- [ ] `git tag -a v1.0.0 -m "v1.0.0 — first stable release"`
- [ ] `git push origin main v1.0.0` — triggers `release.yml`
- [ ] Watch GitHub Actions:
  - [ ] `release.yml` publishes 7 packages with provenance
  - [ ] `install-smoke.yml` validates the install across the 6-cell matrix (ubuntu+macos × npm/pnpm/bun)
- [ ] Verify on npm: `npm view @swt-labs/cli` shows `1.0.0` + provenance attestation
- [ ] Update [`CHANGELOG.md`](CHANGELOG.md) `[1.0.0]` placeholder date with the actual publish date

## Marketplace submission

- [ ] Submit `packages/cli/codex-plugin.json` + `packages/cli/MARKETPLACE.md` to the Codex Plugin Marketplace per its submission process — Phase 12 / PLAN 03 deferral
- [ ] Update `codex-plugin.json` `$schema` URL once Codex publishes the marketplace manifest schema
- [ ] Add real screenshots under `packages/cli/screenshots/` (referenced by `codex-plugin.json`) — Phase 12 / PLAN 03 deviation D2
- [ ] Once accepted: replace the placeholder marketplace URL in `README.md`, `docs/blog/v1-0-launch.mdx`, and `RELEASE-NOTES-v1.0.md`

## Docs deploy

- [ ] Push docs to Mintlify hosting:
  - `pnpm --filter @swt-labs/docs build`
  - Deploy via Mintlify dashboard or `mintlify deploy` (per Mintlify CLI instructions)
- [ ] Verify `docs.stopwastingtokens.dev` resolves (DNS CNAME + Mintlify domain configuration)
- [ ] Run `vale docs/` one last time on the deployed source — resolve any error-severity findings
- [ ] Smoke-check the structure vitest + vale vitest pass on the deployed site
- [ ] Open the docs site and walk Getting Started → Concepts → first Recipe — confirm all internal links work

## VBW deprecation

- [ ] Tag VBW repo at `v1.0.97-final` (or whatever the actual final VBW version number is)
- [ ] Add `.vbw-planning/announcements/vbw-deprecation-notice.md` content to the top of VBW's `README.md` — Phase 14 / PLAN 03 deliverable
- [ ] Pin the deprecation notice issue in VBW's tracker (optional but useful for discoverability)
- [ ] Archive VBW repo to read-only via GitHub repo settings (Settings → General → Danger Zone → Archive this repository)

## Announcements (use the templates in `.vbw-planning/announcements/`)

- [ ] Discord (VBW community): `discord-vbw-community.md`
- [ ] Hacker News (Show HN): `hacker-news-show.md` (post during US business hours for best timing)
- [ ] Reddit (`r/codex` or relevant subs): `reddit-r-codex.md`
- [ ] Twitter/X thread: `twitter-x.md`
- [ ] Personal/company blog (optional): cross-post the content from `docs/blog/v1-0-launch.mdx`
- [ ] LinkedIn (optional): adapt the Twitter thread to a single post

## Demo video

- [ ] Record per `.vbw-planning/announcements/demo-video-script.md` (target 6:00, acceptable 5:00–8:00)
- [ ] Edit + caption + upload to YouTube
- [ ] Embed the YouTube video in `docs/blog/v1-0-launch.mdx` and re-deploy docs
- [ ] Cross-post a 90-second cut to Twitter/X

## Post-launch monitoring (first 48h)

- [ ] Watch the friction issue tracker — triage incoming reports within 4h (per Phase 13 beta-feedback SLA)
- [ ] Watch Discord — first 10 onboards get a personal welcome
- [ ] Watch HN/Reddit comments — respond to top-3 questions
- [ ] Watch npm downloads — sanity-check the install path actually works for new users
- [ ] Watch GitHub Actions — `install-smoke.yml` should stay green on every workflow_run

## Post-launch follow-up (first week)

- [ ] Address top-10 friction reports (Phase 13 success criterion 3 — addressed before v1.0 stable cut)
- [ ] Schedule v1.0.1 patch if anything substantive surfaces
- [ ] Update `CHANGELOG.md` with the actual `0.1.0-alpha` and `1.0.0` publish dates if the placeholders are still there
- [ ] Begin v1.5 scoping per [`docs/v1-5-roadmap/index.mdx`](docs/v1-5-roadmap/index.mdx)

## Notes

- Run this checklist top-to-bottom on launch day. Every section depends on the prior section completing cleanly.
- If something breaks mid-checklist (e.g., `release.yml` fails), fix the underlying issue and re-run from the failed step. Do **not** skip ahead.
- The VBW deprecation notice is the one item that involves a different repo (`Hesreallyhim/awesome-claude-code` or wherever VBW lives). Confirm with VBW maintainers before pushing the deprecation notice — it's the user's call, not auto-merged.
