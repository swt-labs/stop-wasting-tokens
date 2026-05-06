# Contributing to stop-wasting-tokens

Thanks for considering a contribution. The project is in early alpha and the surface is changing quickly, so please open an issue before starting non-trivial work.

## Code of Conduct

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Beta tester

The v0.1.0-alpha closed beta is live. If you want to help shape v1.0:

- Read the [beta tester guide](https://docs.stopwastingtokens.dev/recipes/beta-feedback) — it covers install, what to test, and how to report what you find.
- File [friction reports](.github/ISSUE_TEMPLATE/friction.md) — even subtle "this should be smoother" feedback is signal.
- Join the closed-beta Discord (invite via DM during the beta window).
- Optionally enable anonymous telemetry: `swt config set telemetry.enabled true`.

Top-10 friction items will be addressed before v1.0 release.

## Reporting issues

- **Bug:** use the bug template under `.github/ISSUE_TEMPLATE/`. Include reproduction steps, expected vs actual behaviour, your Node version, OS, and Codex CLI version.
- **Feature request:** use the feature template. Describe the use case before the proposed solution.
- **Question:** use the question template, or join the discussion forum (link TBD once the docs site is live).

## Pull requests

1. Fork the repo, create a branch from `main` (e.g. `feat/something`, `fix/something`).
2. Make your changes. Keep PRs focused — one logical change per PR.
3. Run the project's checks locally before pushing:
   ```
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
   These commands are wired up starting in Phase 2 (Foundation).
4. Add a Changeset entry: `pnpm changeset` and follow the prompts.
5. Open the PR using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
6. CI must pass before review. Maintainers will request changes via review comments.

## Commit conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Examples:

- `feat(cli): add swt status command`
- `fix(codex-driver): handle empty hooks.json`
- `docs(readme): clarify install instructions`
- `chore(deps): bump tsup to 8.x`

The commit type drives Changesets release notes, so please use the right type.

## Originality and licensing of contributions

By submitting a contribution you confirm that:

1. The work is your own, or you have the right to submit it under the project's license.
2. You agree that your contribution is licensed under the same MIT license as the rest of the project (see [LICENSE](LICENSE)).
3. You have not copied source code from any third-party project that is not compatibly licensed.

If a contribution is inspired by published documentation, blog posts, or open-source projects, please cite the source in the PR description.

## Development environment

- **Node:** 20.18+ or 22.x.
- **Package manager:** pnpm (workspaces are used from Phase 2 onward).
- **Editor:** any. We ship `.vscode/settings.json` recommendations once Phase 2 lands.
- **OS:** Linux, macOS, and Windows are all supported. Please report platform-specific issues against the bug template.

## Releasing

Maintainer-only. Releases are cut via the Changesets release workflow. See `docs/releasing.md` (added in Phase 9) for the full procedure.

## Getting help

- Open a question issue for project-related questions.
- For ad-hoc design discussion, the discussion forum is the best venue (link TBD).
- For private maintainer contact, see [SECURITY.md](SECURITY.md).
