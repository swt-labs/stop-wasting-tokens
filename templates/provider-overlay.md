---
overlay_for: { { role } } # e.g., dev | debugger | qa
provider: { { provider } } # e.g., openai | anthropic | google
source: 'github.com/{{source-repo}}' # e.g., github.com/openai/codex
source_paths:
  - '{{path-1}}' # e.g., codex-rs/core/src/prompts.rs
  - '{{path-2}}'
source_intent: '{{one-line summary}}' # e.g., tool-use sequencing + diff-shaped edits
model_families: # optional; reserved for forward compat (Phase 1 ignores)
  - '{{family-1}}' # e.g., gpt-5
last_tuned: '{{YYYY-MM-DD}}'
schema_version: 1
---

# Intent-mirror of {{Provider}} {{role-equivalent}} prompt.

# Source: github.com/{{source-repo}} (paths above)

# Last checked: {{YYYY-MM-DD}}

# DO NOT copy verbatim from the source — paraphrase the intent.

## Tool-use sequencing

{{Describe the provider-tuned tool-call ordering in SWT-native vocabulary. Reference SWT tools — `Edit`, `Bash`, `Read`, `Grep`, `LSP` — not vendor tool names. Encode the discipline (e.g., "read before edit; edit in small chunks; verify with `Bash` after each chunk; diagnose stderr before retry").}}

## Edit conventions

{{Provider-tuned file-edit framing. Anchor on context lines (not line numbers); make minimal, surgical edits; never rewrite whole files unless explicitly asked. Map SWT's `Edit` tool to the same discipline the upstream provider tunes its diff/patch tool for.}}

## Verification pattern

{{Provider-tuned post-edit verification. Run the smallest check that proves the change works (single test file, single grep, single LSP diagnostic). On non-zero exit, diagnose stderr/error output first; propose minimal fix; do NOT escalate to architectural changes.}}

## Response format

{{Provider-tuned response shape. Terse, code-first, no preamble, no trailing summary unless required by SWT's role contract (e.g., SUMMARY.md output). The role prompt's output schema takes precedence over the overlay's response shape — the overlay refines tone + verbosity, not the canonical output artifact.}}

## Error handling

{{Provider-tuned failure mode. When a tool call fails or a test breaks, the model's recovery loop matters. Encode the upstream provider's recovery discipline (diagnose first, fix minimally, no scope creep).}}

## Per-effort tuning (optional — may be omitted in Phase 1)

{{If the provider's tuned prompts vary by reasoning effort (low / medium / high), describe each here. The overlay body is appended in full regardless of effort; future phases may key the resolver on `thinkingLevel` for per-effort branching.}}
