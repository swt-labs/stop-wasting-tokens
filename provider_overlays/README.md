# Provider Overlays

Per-provider prompt overlays. Layered onto role prompts (`agents/swt-<role>.md`) at spawn time when the resolved provider matches.

## What this directory is

The `swt` runtime spawns each agent role with a system prompt built from two layers:

1. **Role prompt** — `agents/swt-<role>.md`. The methodology contract (skill activation, deviation handling, commit discipline, output schemas). Provider-agnostic by design.
2. **Provider overlay (this directory)** — `provider_overlays/<role>-<provider>.md`. A model-aware appendix that tunes HOW the role executes (tool-use sequencing, edit conventions, response formatting) for a specific provider. **Optional** — if no overlay file exists, the role prompt ships unmodified.

Wiring lives in `packages/orchestration/src/provider-overlay.ts` (`readProviderOverlay(installRoot, role, provider)`) and `packages/orchestration/src/spawn-agent.ts:resolveSpawnAgentConfig` (overlay is appended after the role prompt with a `\n\n---\n\n` separator).

## Filename convention

`<role>-<provider>.md` — role-major to match `agents/swt-<role>.md` shape.

Examples:

- `dev-openai.md` — dev role on OpenAI providers.
- `debugger-openai.md` — debugger role on OpenAI providers.
- `qa-openai.md` — qa role on OpenAI providers.

The role component MUST match a role known to the runtime (see `packages/orchestration/src/role-router.ts`). The provider component MUST match a provider id known to the router (see `packages/orchestration/src/provider-router.ts`).

## Frontmatter schema

YAML frontmatter is REQUIRED on every overlay (for traceability — see "Authoring discipline" below). It is **stripped before append**; the model never sees the YAML.

Fields:

| Field            | Required        | Description                                                                                                              |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `overlay_for`    | yes             | The role this overlay tunes (e.g., `dev`). Must match the filename's role component.                                     |
| `provider`       | yes             | The provider id (e.g., `openai`). Must match the filename's provider component.                                          |
| `source`         | yes             | The repo / project the intent was derived from (e.g., `github.com/openai/codex`).                                        |
| `source_paths`   | yes (list)      | Specific modules / files in the source where the tuned intent lives.                                                     |
| `source_intent`  | yes             | One-line summary of what was mirrored (e.g., `"tool-use sequencing + apply_patch edit framing"`).                        |
| `model_families` | optional (list) | Forward-compat for per-family granularity. Phase 1 reads but ignores. See "Resolution order — R3" below.                 |
| `last_tuned`     | yes             | ISO date (`YYYY-MM-DD`) of the last verification against the source.                                                     |
| `schema_version` | yes             | Integer. Phase 1 ships `1`. Bumps when frontmatter shape changes.                                                        |

The resolver MECHANICALLY strips any leading frontmatter delimited by `---\n` ... `---\n` — it does NOT validate field shape today. Field-level validation may land in a future plan; the schema is currently a **documentation contract** authors are expected to follow.

## Authoring discipline (intent-mirror, not text copy)

**Critical:** For overlays mirroring public coding-agent prompts (e.g., OpenAI Codex CLI), **paraphrase the intent in SWT-native vocabulary**. Do NOT copy verbatim text from `github.com/openai/codex` (or equivalent upstreams).

Concrete rule:

- Reference SWT's tools (`Edit`, `Bash`, `Read`, `Grep`, `LSP`) in body text. Do NOT name vendor tools (`apply_patch`, `shell`) — encode the same DISCIPLINE (anchor on context, edit in chunks, verify after) using SWT's vocabulary.
- The frontmatter `source` + `source_paths` + `source_intent` fields are the traceability hook. They cite WHERE the intent came from; the body text rewrites it.
- Each overlay opens with a header comment:
  ```
  # Intent-mirror of OpenAI Codex CLI <role-equivalent> prompt.
  # Source: github.com/openai/codex (codex-rs/core/src/prompts/...)
  # Last checked: <YYYY-MM-DD>
  # DO NOT copy verbatim from the source — paraphrase the intent.
  ```

Rationale: avoids legal risk of verbatim prompt copying AND keeps overlays maintainable when upstream wording shifts. Mirroring the INTENT (e.g., "diff-shaped edits with anchor-on-context", "verify after each chunk") is durable; mirroring the text is brittle.

## Resolution order

The resolver looks for, in order:

1. `<role>-<provider>-<model-family>.md` — **future (Phase 1 does NOT implement this step)**. Reserved for per-family granularity (R3 forward-compat).
2. `<role>-<provider>.md` — **Phase 1's only resolution step**.
3. No file found → no overlay → byte-identical to today's role-prompt-only behavior.

When a future plan flips on step 1, it reads `frontmatter.model_families` from the per-provider file to decide whether to fall through, OR uses a dedicated family-suffixed file.

### R3 decision — per-provider only in Phase 1

Phase 1 ships per-provider overlays only. The `model_families` frontmatter field is reserved for forward compatibility but is NOT consumed by the resolver today. The resolution-order list above marks step 1 as "(future — Phase 1 does not implement step 1)".

Rationale: shipping 3 overlays × 1 provider = 3 files is the minimum viable surface. Adding family granularity multiplies the matrix without evidence the families need different prompts yet. The resolver code-path supports either; Phase 1 ships step 2 only, and a future plan can flip on step 1 without re-touching any overlay already authored.

## Runtime behavior

- Overlay body (frontmatter stripped, trimmed) is appended to the role prompt with `\n\n---\n\n` separator.
- The system block becomes byte-identical per `{role, provider}` pair → preserves cache-prefix invariance (Anthropic / OpenAI auto-cache).
- No overlay file → no append → vendor-neutrality preserved (Anthropic/Google/OpenRouter runs byte-identical to pre-Phase-1).
- Resolver is ENOENT-safe: missing file returns `undefined`, never throws. Every non-overlay spawn hits this path; throwing would break the runtime.

## Authoring a new overlay

1. `cp templates/provider-overlay.md provider_overlays/<role>-<provider>.md`
2. Fill in the frontmatter fields (especially `source_paths` + `source_intent`).
3. Author the body in SWT-native vocabulary (intent-mirror discipline above).
4. No code changes needed — the resolver picks up the new file on next spawn.
5. Add a unit test if the overlay touches behavior the wiring tests don't already cover (most overlays don't need new tests — the resolver tests in `packages/orchestration/test/provider-overlay.test.ts` cover the resolution contract).

## Phase 1 inventory

Phase 1 ships exactly 3 overlays (plan 01-03):

- `dev-openai.md`
- `debugger-openai.md`
- `qa-openai.md`

All other roles + all other providers have NO overlay → fall through to today's role-prompt-only behavior.

## See also

- `templates/provider-overlay.md` — copy-paste scaffold.
- `packages/orchestration/src/provider-overlay.ts` — runtime resolver (`readProviderOverlay`).
- `packages/orchestration/src/spawn-agent.ts` — overlay-append wiring (`resolveSpawnAgentConfig`).
- `a_non_production_files/codex_cli_fix.md` — Option A design doc (problem statement + ranked options).
- `.vbw-planning/phases/01-codex-cli-prompt-overlays/01-RESEARCH.md` — research + risk register (R1–R5).
