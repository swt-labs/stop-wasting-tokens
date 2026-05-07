---
phase: 01
plan: 01-02
title: Codex marketplace + agent template polish
status: complete
completed: 2026-05-06
tasks_completed: 4
tasks_total: 4
commit_hashes: []
deviations:
  - "T1 model identifier: chose `gpt-5-codex` (real OpenAI Codex coding-tuned model launched 2025-09) over Approach A (`model = 'default'` sentinel) because the sentinel pattern isn't documented in any Codex CLI surface I can verify; pinning a real model makes the template loadable today, with Phase 2 (F1 wiring) the natural place to revisit if the model identifier proves wrong at runtime."
  - "T2 $schema: removed entirely rather than substituting a real URL. JSON Schema's `$schema` is metadata, not a constraint; removing it doesn't affect manifest validity. The Codex Plugin Marketplace's actual schema URL is unverified — flag for user-side confirmation before submission. The new manifest test asserts that any future re-introduction of `$schema` cannot point at example.com / .example domains."
  - "T3 MCP servers: chose to label as illustrative via a TOML header comment rather than replace with real identifiers, because real MCP server names depend on what the user has configured in `~/.codex/mcp.json` — SWT cannot prescribe them. The header makes the override path discoverable without breaking the file."
pre_existing_issues: []
ac_results:
  - criterion: "no agent TOML hardcodes a fictional model identifier"
    verdict: "pass"
    evidence: "all 6 agents-templates/*.toml now declare `model = 'gpt-5-codex'`; `grep -RIn 'gpt-5.5' agents-templates/` returns no matches"
  - criterion: "Codex Plugin Marketplace manifest carries either a real schema URL or no $schema key — never a placeholder"
    verdict: "pass"
    evidence: "packages/cli/codex-plugin.json has no `$schema` field; new test packages/cli/test/codex-plugin-manifest.test.ts case `does not reference RFC-2606 reserved or placeholder schema URLs` passes"
  - criterion: "allowed_mcp_servers in agent TOMLs are either real MCP server identifiers or labelled as illustrative placeholders in a comment header"
    verdict: "pass"
    evidence: "each of the 6 agents-templates/*.toml files now leads with a 4-line comment block explaining `allowed_mcp_servers` are illustrative and pointing at `~/.codex/mcp.json` for real identifiers"
---

Removed the fictional `gpt-5.5-pro` model identifier across the 6 agent profile templates, dropped the placeholder Codex Plugin Marketplace schema URL, labelled the placeholder MCP server identifiers, and added a new manifest validity test.

## What Was Built

- All 6 agent profile templates (`scout`, `architect`, `lead`, `dev`, `qa`, `debugger`) now declare `model = "gpt-5-codex"` (a real OpenAI-shipped Codex coding-tuned model from 2025-09)
- Each template gained a 4-line header comment explaining how to override `model` and the illustrative nature of `allowed_mcp_servers`
- `packages/cli/codex-plugin.json` no longer declares a placeholder `$schema` field; the manifest validates as ordinary JSON without a schema reference
- New test suite `packages/cli/test/codex-plugin-manifest.test.ts` (4 cases) asserting JSON validity, schema URL hygiene, install metadata, and command-list completeness — all pass

## Files Modified

- `agents-templates/scout.toml` — model `gpt-5.5-pro` → `gpt-5-codex`; add header comment
- `agents-templates/architect.toml` — same
- `agents-templates/lead.toml` — same
- `agents-templates/dev.toml` — same
- `agents-templates/qa.toml` — same
- `agents-templates/debugger.toml` — same
- `packages/cli/codex-plugin.json` — remove `$schema` placeholder line
- `packages/cli/test/codex-plugin-manifest.test.ts` — new file, 4 test cases

## Deviations

See frontmatter `deviations:` for details. Three judgment-call deviations:

1. Pinned `model = "gpt-5-codex"` rather than the `"default"` sentinel.
2. Removed `$schema` rather than substituting a real URL we can't verify.
3. Labelled MCP server placeholders rather than replacing them.

Each is a deliberate choice with rationale captured in the deviation notes.

## Verification

1. ✅ `grep -RIn 'gpt-5.5\|codex\.example' agents-templates/ packages/cli/` returns no matches
2. ✅ `node -e "JSON.parse(require('fs').readFileSync('packages/cli/codex-plugin.json'))"` exits 0
3. ✅ `vitest run packages/cli/test/codex-plugin-manifest.test.ts packages/codex-driver/test/agents-md.test.ts` — 9/9 pass

## Next

Plan 01-03 (Documentation + scripts cleanup) starts next.
