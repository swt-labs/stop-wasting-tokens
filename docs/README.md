# @swt-labs/docs

Documentation site for stop-wasting-tokens, built with [Mintlify](https://mintlify.com).

## Local development

```bash
pnpm install
pnpm --filter @swt-labs/docs dev
# Open http://localhost:3000
```

The dev server hot-reloads `*.mdx` and `docs.json` changes. Mintlify CLI is a workspace devDependency — no global install needed.

## Build (preview)

```bash
pnpm --filter @swt-labs/docs build
```

## Prose linting

We use [Vale](https://vale.sh) with the Microsoft + write-good styles plus an SWT vocabulary. Vale runs in CI on every PR touching `docs/**`.

```bash
# Local lint (requires vale binary)
pnpm --filter @swt-labs/docs lint:vale

# Optional pre-commit hook (one-time install)
ln -s ../../docs/scripts/pre-commit-vale.sh .git/hooks/pre-commit-vale
```

## Tests

The structure test (`test/structure.test.ts`) validates `docs.json` parses, every page reference resolves, and the navigation matches the canonical 6-section layout.

```bash
pnpm --filter @swt-labs/docs test
```

## Deployment

> **User-side action required.** This docs package is a static-site source; production hosting is configured externally.

The plan: deploy to `docs.stopwastingtokens.dev` via Mintlify hosting (project ID set in the Mintlify dashboard, not in `docs.json`). Steps:

1. Create a Mintlify project at https://mintlify.com (login with the swt-labs GitHub org).
2. Connect the `swt-labs/stop-wasting-tokens` repo, source path `docs/`.
3. Configure custom domain `docs.stopwastingtokens.dev` (CNAME → Mintlify-provided hostname).
4. Add `MINTLIFY_ANALYTICS_TOKEN` to GitHub Actions secrets if Google Analytics is desired.

Until DNS + Mintlify hosting are live, the docs are buildable + previewable locally. This is tracked as a Phase 11 deviation — engineering deliverables ship in this milestone; deployment is a Phase 12 / launch-time follow-up.

## Editing tips

- Use Mintlify components (`<CardGroup>`, `<Card>`, `<CodeGroup>`, `<Tabs>`) — they degrade gracefully and look better than plain markdown.
- Keep prose in `getting-started/`, `concepts/`, and `recipes/` conversational. Reference docs (`reference/`) can be denser.
- Vale will flag overly-passive or jargon-heavy prose; either fix it or add an inline `<!-- vale ... = NO -->` block with a one-line justification.
- Add new project-specific terms to `styles/config/vocabularies/SWT/accept.txt` instead of fighting Vale.

## Contributing

- New page → add file under the appropriate section directory + add a navigation entry in `docs.json`.
- Renamed or moved page → update `docs.json` to match. The structure test will catch missing references.
- Schema-driven reference (CLI / config / artifacts) — see annotations like `<!-- AUTO-DERIVE-CANDIDATE -->` for sections planned to auto-generate from source in v1.5.
