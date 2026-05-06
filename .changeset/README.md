# Changesets

This directory holds [Changesets](https://github.com/changesets/changesets) — pending entries that describe what changed and how to bump the version.

## Adding a changeset

```
pnpm changeset
```

Pick the package(s) affected, the bump type (patch / minor / major), and write a short summary. The CLI will create a Markdown file under this directory which will be picked up by the release workflow.

## Releasing

A maintainer-only workflow. The `release.yml` GitHub Action opens a "Version Packages" PR whenever changesets accumulate on `main`. Merging that PR triggers `pnpm changeset publish`, which versions the packages, tags, and pushes to npm with provenance.
