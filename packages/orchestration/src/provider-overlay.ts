/**
 * Per-provider prompt overlay resolver — Phase 1 / G-R1 / G-M1.
 *
 * Reads a per-provider prompt overlay from disk and returns its body
 * (frontmatter stripped). Used by `spawnAgent` / `spawnOrchestratorSession` to
 * append model-aware appendices onto role prompts at spawn time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Architect decisions captured (Lead risk register)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   R1 — Overlay precedence: APPEND-AFTER. Methodology contract (role
 *        prompt) is read first; the overlay is appended with `\n\n---\n\n`
 *        as a visible boundary. Append-after preserves the cache prefix
 *        invariance described in `prompt-builder.ts:88-91`.
 *
 *   R2 — Provider detection: CALLER-RESOLVES. The router lives at the
 *        cook callsite; spawn paths take an optional `provider?: string`
 *        and call this resolver only when the caller supplied a provider.
 *
 *   R4 — Vendor-neutrality preserved BY CONSTRUCTION. When no overlay
 *        file exists, the resolver returns `undefined` and the caller
 *        falls through to today's exact behavior. Anthropic/Google/
 *        OpenRouter runs are byte-identical to pre-Phase-1 (every non-
 *        OpenAI spawn hits this no-op path; throwing would break them).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Layout (per Phase 1 R3 — per-provider only)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   `<installRoot>/provider_overlays/<role>-<provider>.md`
 *
 * Flat per-role × per-provider layout. No model-family granularity in
 * Phase 1 — that is a deferred architect decision (R3).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read a per-provider overlay from disk. Pure function with the same
 * determinism contract as `buildPrompt` (no clock, no random, no env).
 *
 * Contract:
 *   - `provider` `undefined` or empty-string → returns `undefined`
 *     (overlay-disabled fast path).
 *   - File missing at `<installRoot>/provider_overlays/<role>-<provider>.md`
 *     → returns `undefined`. MUST NOT throw on ENOENT — every non-OpenAI
 *     spawn hits this path.
 *   - File present → returns the trimmed body, with YAML frontmatter
 *     stripped if present.
 *   - Deterministic — same inputs → same output.
 */
export function readProviderOverlay(
  installRoot: string,
  role: string,
  provider: string | undefined,
): string | undefined {
  if (provider === undefined || provider.length === 0) {
    return undefined;
  }
  const path = resolve(installRoot, 'provider_overlays', `${role}-${provider}.md`);
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = readFileSync(path, 'utf8');
  return stripFrontmatter(raw).trim();
}

/**
 * Strip a leading YAML frontmatter block delimited by `---\n` ... `---\n`.
 * If no frontmatter is present (or the leading delimiter is missing), the
 * input is returned unchanged. Pure function; no schema validation of
 * frontmatter contents (the schema doc + template are 01-02 concerns).
 */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n')) {
    return raw;
  }
  // Find the closing `---\n` AFTER the first 4 chars (i.e., after the opener).
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    return raw;
  }
  return raw.slice(closeIdx + 5);
}
