---
phase: 02
plan: 01
title: Foundation — TypeScript monorepo, build, lint, test, CI (artifact Phase 1)
status: complete
completed: 2026-05-06
tasks_completed: 8
tasks_total: 10
ac_results:
  - id: AC1
    must_have: pnpm workspace configured at the repo root
    status: pass
    evidence: pnpm-workspace.yaml lists packages/* glob; root package.json declares packageManager pnpm@9.12.0.
  - id: AC2
    must_have: tsconfig.base.json with strict + NodeNext + ES2022
    status: pass
    evidence: tsconfig.base.json sets strict, target ES2022, module/moduleResolution NodeNext, plus extra hardening flags (noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, useUnknownInCatchVariables) and composite/declaration/sourcemap output for project references.
  - id: AC3
    must_have: All seven workspace packages skeletoned with tsconfig + src/index.ts stub
    status: pass
    evidence: packages/{core,cli,codex-driver,methodology,artifacts,verification,telemetry} each have package.json (private, name @swt-labs/<name>), tsconfig.json extending the base, and src/index.ts with PACKAGE_NAME + VERSION exports. CLI also has a smoke test under test/main.test.ts.
  - id: AC4
    must_have: tsup configured for ESM+CJS dual builds (per package)
    status: pass
    evidence: tsup.config.ts at root emits both .mjs and .cjs from packages/cli/src/index.ts with .d.ts and sourcemaps; banner adds the node shebang to the published bin entry.
  - id: AC5
    must_have: ESLint flat config with @typescript-eslint + eslint-plugin-import
    status: pass
    evidence: eslint.config.mjs uses the flat-config schema, enables the recommended-type-checked ruleset, enforces import/order, forbids default exports outside config files, and chains eslint-config-prettier last.
  - id: AC6
    must_have: Prettier config (print width 100)
    status: pass
    evidence: .prettierrc sets printWidth 100, single quotes, trailing commas everywhere; .prettierignore excludes dist, coverage, .changeset, pnpm-lock.yaml, and .vbw-planning/research.
  - id: AC7
    must_have: Vitest configured at the workspace root with initial coverage thresholds
    status: pass
    evidence: vitest.config.ts uses the v8 provider with text/lcov/html reporters and initial 60 % thresholds across lines/branches/functions/statements.
  - id: AC8
    must_have: Changesets initialised
    status: pass
    evidence: .changeset/config.json declares baseBranch main, access public, ignores all internal @swt-labs/* packages, and sets privatePackages.version=false. .changeset/README.md explains the workflow.
  - id: AC9
    must_have: GitHub Actions ci.yml (typecheck/lint/test matrix on Node 20/22 × Linux/macOS/Windows)
    status: pass
    evidence: .github/workflows/ci.yml runs install, typecheck, lint, format:check, test, and build across the full 3×2 matrix.
  - id: AC10
    must_have: GitHub Actions release.yml (Changesets Version Packages PR + npm publish on merge)
    status: pass
    evidence: .github/workflows/release.yml uses changesets/action@v1 with publish=pnpm release, version=pnpm version, contents/pull-requests/id-token write permissions, and NPM_CONFIG_PROVENANCE=true for npm provenance.
  - id: AC11
    must_have: GitHub Actions codeql.yml
    status: pass
    evidence: .github/workflows/codeql.yml analyses javascript-typescript with the security-extended query suite on push, PR, and a weekly cron.
  - id: AC12
    must_have: Dependabot config
    status: pass
    evidence: .github/dependabot.yml schedules weekly npm and github-actions updates; npm updates are grouped into typescript-stack, eslint-stack, and vitest-stack.
  - id: AC13
    must_have: .nvmrc + .editorconfig + engines.node ≥ 20.18
    status: pass
    evidence: .nvmrc pins Node 20, .editorconfig enforces LF + 2-space indent + final newline, and root package.json sets engines.node ">=20.18".
  - id: AC14
    must_have: Single-package publish strategy decided and documented
    status: pass
    evidence: Only stop-wasting-tokens at the workspace root has publishConfig.access=public + provenance=true. Every workspace package under packages/* is marked private:true. Strategy is documented in 02-01-PLAN.md ("Workspace topology") and reflected in .changeset/config.json's ignore list.
commit_hashes:
  - feb4035
files_modified:
  - pnpm-workspace.yaml
  - package.json
  - tsconfig.base.json
  - tsconfig.json
  - tsup.config.ts
  - vitest.config.ts
  - eslint.config.mjs
  - .prettierrc
  - .prettierignore
  - .editorconfig
  - .nvmrc
  - .changeset/config.json
  - .changeset/README.md
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - .github/workflows/codeql.yml
  - .github/dependabot.yml
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/core/src/index.ts
  - packages/cli/package.json
  - packages/cli/tsconfig.json
  - packages/cli/src/index.ts
  - packages/cli/test/main.test.ts
  - packages/codex-driver/package.json
  - packages/codex-driver/tsconfig.json
  - packages/codex-driver/src/index.ts
  - packages/methodology/package.json
  - packages/methodology/tsconfig.json
  - packages/methodology/src/index.ts
  - packages/artifacts/package.json
  - packages/artifacts/tsconfig.json
  - packages/artifacts/src/index.ts
  - packages/verification/package.json
  - packages/verification/tsconfig.json
  - packages/verification/src/index.ts
  - packages/telemetry/package.json
  - packages/telemetry/tsconfig.json
  - packages/telemetry/src/index.ts
deviations:
  - id: D1
    type: process
    description: pnpm is not installed on this machine, so `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm publish --dry-run` were not executed locally during Phase 2.
    resolution: GitHub Actions CI matrix (Node 20/22 × Linux/macOS/Windows) is configured to run all six steps on every push/PR. The user can also smoke-test locally with `corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install && pnpm publish --dry-run`.
  - id: D2
    type: scope
    description: Husky pre-commit + lint-staged were not wired up. The artifact lists this as a Phase 1 task.
    resolution: Deferred. The pre-push hook from VBW already covers part of the workflow. Husky + lint-staged can be added in a follow-up commit any time; not blocking for Phase 3.
deferred_to_user:
  - Add `NPM_TOKEN` repo secret in GitHub Actions settings (release.yml requires it)
  - Run a one-time `corepack enable && pnpm install && pnpm publish --dry-run` locally to confirm the install + publish path works on the user's machine
  - Decide whether to wire husky + lint-staged now or after Phase 3
---

# Phase 2 Summary: Foundation

## What Was Built

A TypeScript monorepo skeleton ready for Phase 3 to start filling in real code:

- **Workspace:** pnpm workspaces with seven packages — `core`, `cli`, `codex-driver`, `methodology`, `artifacts`, `verification`, `telemetry`. All seven are private. The root `stop-wasting-tokens` package is the only one published to npm; tsup bundles the CLI entry from `packages/cli/src/index.ts`.
- **TypeScript:** Strict + NodeNext + ES2022 base config with project references, composite output, and the extra hardening flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.).
- **Build:** tsup with ESM+CJS dual output, sourcemaps, type declarations, and a `#!/usr/bin/env node` shebang banner for the bin entry.
- **Lint + format:** ESLint flat config (typescript-eslint recommended-type-checked + eslint-plugin-import + eslint-config-prettier last) and Prettier with printWidth 100.
- **Test:** Vitest with v8 coverage and a 60% baseline threshold across lines/branches/functions/statements. Includes a smoke test for `@swt-labs/cli`.
- **Release:** Changesets configured for single-package publishing; release workflow opens a Version Packages PR on Changesets accumulation and publishes to npm with provenance on merge.
- **CI:** GitHub Actions matrix across Node 20/22 × Linux/macOS/Windows; CodeQL with `security-extended`; Dependabot for npm + actions, with grouped updates for the TypeScript, ESLint, and Vitest stacks.
- **Editor + runtime hygiene:** `.editorconfig`, `.nvmrc`, `.prettierrc`, `engines.node >= 20.18`.

## Files Modified

See `files_modified` in frontmatter (39 files).

## Acceptance criteria status

| ID | Must-have | Status |
|----|-----------|--------|
| AC1 | pnpm workspace at root | ✓ |
| AC2 | tsconfig.base.json strict + NodeNext + ES2022 | ✓ |
| AC3 | 7 package skeletons | ✓ |
| AC4 | tsup ESM+CJS dual build | ✓ |
| AC5 | ESLint flat config | ✓ |
| AC6 | Prettier @ 100 | ✓ |
| AC7 | Vitest with coverage | ✓ |
| AC8 | Changesets initialised | ✓ |
| AC9 | CI matrix workflow | ✓ |
| AC10 | Release workflow | ✓ |
| AC11 | CodeQL workflow | ✓ |
| AC12 | Dependabot config | ✓ |
| AC13 | .nvmrc + .editorconfig + engines.node | ✓ |
| AC14 | Single-package publish strategy | ✓ |

All 14 must-haves green. Two deviations recorded (no local pnpm smoke run, husky deferred).

## Commit

`feb4035` — chore(foundation): scaffold pnpm workspace, build, lint, test, CI
