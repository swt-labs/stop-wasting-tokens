# `apply_patch.lark` — vendored Lark grammar metadata

This sidecar file records vendoring metadata for `apply_patch.lark`. It is
kept separate so the `.lark` file itself remains **byte-identical** to the
upstream source — `audit-upstream-prompts.sh` re-fetches the upstream URL
and compares sha256 against the vendored file directly.

| Field | Value |
| --- | --- |
| `sha256` | `d6367f4826ed608c424b0a308f3d6163527df63c22513d089b91863552f8bfeb` |
| `pinned_at_sha` | `adca1b643fd0d2733030ef4fdaf5273036f02d9a` |
| `source_url` | `https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/apply_patch.lark` |
| `vendored_date` | `2026-05-18` |
| `consumed_by` | `scripts/codegen/apply-patch-from-lark.ts` (generator) → `packages/runtime/src/extensions/apply-patch-parser.ts` (generated parser) |
| `drift_detection` | `scripts/audit-upstream-prompts.sh` via `CodexViaOverlayPack.upstreamSources()` entry 2 (Phase 5) |

## Why a sidecar instead of inline comments?

Inline `//` Lark comments would mutate the file body and shift the sha256
away from the upstream hash. By keeping the `.lark` body byte-identical to
upstream, the drift-detection pipeline can do a direct `shasum -a 256`
comparison without re-stripping comments. This is the simplest, most
mechanical drift-check possible.

## Regenerating the parser

When `audit-upstream-prompts.sh` reports drift on this source:

1. Re-vendor the new grammar to `references/codex/apply_patch.lark`.
2. Run `pnpm gen:apply-patch-parser` — overwrites
   `packages/runtime/src/extensions/apply-patch-parser.ts` in place.
3. Re-run `pnpm typecheck && pnpm --filter @swt-labs/runtime test` to
   confirm all 14 existing parser test cases still pass.
4. Update the `contentHash` + `lastReviewedSha` in
   `CodexViaOverlayPack.upstreamSources()` (entry index 2).
5. Update this frontmatter (`sha256`, `pinned_at_sha`, `vendored_date`).
6. Commit the regeneration as a single atomic refactor commit.
