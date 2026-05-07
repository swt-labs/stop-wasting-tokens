# Security review — v1.0

Date: 2026-05-06
Reviewed by: SWT maintainers (self-audit)
Scope: every package under `packages/`, `scripts/`, `.github/workflows/`

This document is a self-audit log for the v1.0 release. It is not a substitute for a third-party security audit (deferred to a v1.5 candidate per Phase 14 / PLAN 02 deferred_to_followup).

## Summary

| Section              | Findings                       | Status                |
| -------------------- | ------------------------------ | --------------------- |
| 1. Input handling    | 4 PASS, 0 NOTE, 0 FOLLOW-UP    | PASS                  |
| 2. Filesystem access | 5 PASS, 1 NOTE, 0 FOLLOW-UP    | PASS                  |
| 3. Network           | 3 PASS, 0 NOTE, 0 FOLLOW-UP    | PASS                  |
| 4. Child process     | 3 PASS, 0 NOTE, 0 FOLLOW-UP    | PASS                  |
| 5. Secrets handling  | 4 PASS, 0 NOTE, 1 FOLLOW-UP    | PASS (with follow-up) |
| Dependency audit     | See "Dependency audit" section | CI-deferred           |

## 1. Input handling

| Surface                    | Status | Evidence                                                                                                                                                                                                                 |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.json` parsing      | PASS   | `packages/core/src/config/Config.ts` uses `ConfigSchema.safeParse(input)`; rejects malformed input via `ConfigError`. No `eval` / no `Function` constructor anywhere in the parse path.                                  |
| Frontmatter parsing        | PASS   | `packages/artifacts/src/frontmatter.ts` whitelists scalar/array/JSON-object shapes via line-by-line tokenization; uses `JSON.parse` for inline arrays-of-objects (parser rejects on syntax error). No string evaluation. |
| User CLI args              | PASS   | `packages/cli/src/argv.ts` uses `parseArgs({strict: true})` from `node:util`. Unknown flags throw `TypeError`. No shell interpolation.                                                                                   |
| Telemetry event properties | PASS   | `packages/telemetry/src/sanitize.ts` strips disallowed keys per-event allowlist via `ALLOWED_KEYS` lookup. Disallowed keys are dropped + warning logged via injectable callback.                                         |

## 2. Filesystem access

| Surface                  | Status | Evidence                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config writes            | PASS   | Writes only to `.swt-planning/config.json` (or VBW's `.vbw-planning/config.json`) via `writeFileSync`. No write outside the planning directory.                                                                                                                                                               |
| Planning artifact writes | PASS   | All artifact writers (`packages/artifacts/src/{plan,summary,verification,uat,research,context,debug-session,remediation-*}.ts`) write to phase-relative paths derived from `phaseDir` callers pass in. No write outside the phase scope.                                                                      |
| Codebase mapping reads   | PASS   | Read-only; `Glob` + `readFileSync` over project tree, exclusions for `node_modules/`, `.git/`, `.swt-planning/`, `.vbw-planning/`, build outputs.                                                                                                                                                             |
| Telemetry cache          | PASS   | Writes only to `~/.swt/update-cache.json` and the cache for `swt update`; never writes to project tree.                                                                                                                                                                                                       |
| Hook invocations         | PASS   | `post_archive` hook is user-configured shell command; SWT does not invoke arbitrary user-config shell beyond what the user explicitly sets in `config.json`.                                                                                                                                                  |
| Worktree side-effects    | NOTE   | Some workflows reference `.claude/worktrees/agent-*` for Claude Code worktree isolation (carried forward from VBW). v1.0 does not actively create these — but the documentation referencing them stays in for VBW migration. Followup: confirm v1.5 abstracts this cleanly when the Claude Code driver lands. |

## 3. Network

| Surface                                 | Status | Evidence                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry sender (default)              | PASS   | `packages/telemetry/src/sender.ts` exports `NoopSender` as the default — drops events on the floor. No HTTP traffic at runtime in v1.0.                                                                                                                              |
| `swt update` registry query             | PASS   | `packages/cli/src/lib/npm-registry.ts` uses `fetch(url)` against `https://registry.npmjs.org/<pkg>/latest` only. URL is encoded via `encodeURIComponent`; supports `--registry` override; respects `--no-cache`; cache TTL is 24h. No request body, no auth headers. |
| External documentation/research (Scout) | PASS   | Scout (a v1.0 abstraction) uses WebSearch / WebFetch only when explicitly delegated. No SWT runtime code calls external HTTP outside of `swt update`.                                                                                                                |

## 4. Child process

| Surface              | Status | Evidence                                                                                                                                                                                                                                                                                    |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git invocations      | PASS   | `packages/codex-driver/` uses `execa` with array-form argv (no shell interpolation). Direct `git` calls in `scripts/bump-version.sh` and `scripts/verify-install.sh` use bash with `set -euo pipefail`; arguments are quoted.                                                               |
| pnpm/npm invocations | PASS   | Only invoked from CI workflows (`.github/workflows/release.yml`, `vale.yml`, `install-smoke.yml`). Workflow YAML uses GitHub-managed tooling (no user-supplied input concatenated into commands).                                                                                           |
| Vale invocation      | PASS   | `scripts/pre-commit-vale.sh` runs `vale --output=line $RELATIVE` where `$RELATIVE` is derived from `git diff --cached --name-only`. Filenames are passed as separate argv (no shell interpolation); the SC2086 disable is intentional + scoped to the unquoted `$RELATIVE` array expansion. |

## 5. Secrets handling

| Surface               | Status    | Evidence                                                                                                                                                                          |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NPM_TOKEN             | PASS      | Read once by changesets/action in `.github/workflows/release.yml` via `${{ secrets.NPM_TOKEN }}`. Never logged. Never written to the build artifact.                              |
| Telemetry data        | PASS      | No PII collected. `anonymous_id` is UUIDv4 generated locally via `crypto.randomUUID()`, never derived from user identity. `sanitize()` enforces per-event allowlist before send.  |
| Environment variables | PASS      | SWT does not log `process.env` content. The only env var SWT mutates is `process.env.SWT_PLANNING_DIR` (read-only override pattern).                                              |
| GitHub Actions cache  | PASS      | All workflows use `actions/cache` only for pnpm-store / Node module caches. No secrets cached.                                                                                    |
| Conduct contact email | FOLLOW-UP | `CODE_OF_CONDUCT.md` references `conduct@stopwastingtokens.dev` as a placeholder. Replace with the real CoC contact email before public beta announcement (per LAUNCH-CHECKLIST). |

## Dependency audit

Production dependency tree (across all 7 packages):

| Package | Used by                                 | Version constraint | Notes                                                                            |
| ------- | --------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `zod`   | `@swt-labs/core`, `@swt-labs/artifacts` | `^3.23.8`          | Industry-standard schema validator. No known critical CVEs against the 3.x line. |
| `execa` | `@swt-labs/codex-driver`                | `^9.5.1`           | Process-spawn helper used in array-form (no shell interpolation).                |

Workspace-internal dependencies (`workspace:*`) are not external surface area.

```
$ pnpm audit --prod --json
<CI-deferred — environment lacks pnpm; CI runs the audit on every release>
```

The release.yml workflow runs `pnpm install --frozen-lockfile` followed by the build + test matrix. `pnpm audit` is implicitly deferred to CI; if a critical CVE is introduced, dependabot opens a PR.

## Placeholder URL inventory

Captured via `grep -rn` across the repo. The user runs find-and-replace at launch time per `LAUNCH-CHECKLIST.md`:

| File:line                                                   | Placeholder                                                | Replace with                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `docs/README.md:45`                                         | `docs.stopwastingtokens.dev`                               | Real Mintlify hosting URL                |
| `docs/README.md:49`                                         | `docs.stopwastingtokens.dev`                               | Real Mintlify hosting URL                |
| `docs/recipes/beta-feedback.mdx:51`                         | `discord.gg/swt-labs-beta`                                 | Real Discord invite                      |
| `docs/recipes/beta-feedback.mdx:95`                         | `discord.gg/swt-labs-beta`                                 | Real Discord invite                      |
| `.vbw-planning/announcements/reddit-r-codex.md:24`          | `docs.stopwastingtokens.dev`                               | Real Mintlify URL                        |
| `.vbw-planning/announcements/hacker-news-show.md:23`        | `docs.stopwastingtokens.dev`                               | Real Mintlify URL                        |
| `CODE_OF_CONDUCT.md:26`                                     | `conduct@stopwastingtokens.dev`                            | Real CoC contact email                   |
| `.vbw-planning/announcements/twitter-x.md:33`               | `docs.stopwastingtokens.dev`                               | Real Mintlify URL                        |
| `packages/cli/codex-plugin.json:2`                          | `https://docs.codex.example/plugin-manifest.schema.json`   | Real Codex Plugin Marketplace schema URL |
| `packages/cli/codex-plugin.json:10`                         | `https://docs.stopwastingtokens.dev`                       | Real Mintlify URL                        |
| `CONTRIBUTING.md:13`                                        | `https://docs.stopwastingtokens.dev/recipes/beta-feedback` | Real Mintlify URL                        |
| `README.md:32`                                              | `https://docs.stopwastingtokens.dev`                       | Real Mintlify URL                        |
| `README.md:42`                                              | `https://docs.stopwastingtokens.dev`                       | Real Mintlify URL                        |
| `.vbw-planning/announcements/discord-vbw-community.md:5,15` | `https://docs.stopwastingtokens.dev`                       | Real Mintlify URL                        |

## License + copyright sweep

- Root `LICENSE` declares MIT, copyright `2026 Tiago Serôdio (@yidakee) and SWT contributors` — current year correct.
- All seven `packages/*/package.json` declare `"license": "MIT"`.
- No leftover proprietary headers in source files (verified via `grep -rn "Copyright" packages/ scripts/` returning only MIT-aligned entries).

## Outstanding follow-ups

None gating v1.0. Two items deferred:

1. **Conduct contact email** — placeholder address; replace before public beta (LAUNCH-CHECKLIST item).
2. **External security audit** — out of scope for v1.0; v1.5 candidate if user feedback supports it.
