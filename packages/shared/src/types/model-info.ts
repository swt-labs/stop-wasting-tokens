/**
 * Per-model context-window lookup — Statusline-extension milestone, Step 3 of 8
 * per a_non_production_files/statusline.md.
 *
 * SWT had no shared model-info table before this file. Cost projection
 * (`packages/runtime/src/budget/cost-projector.ts` + rate-card) currently
 * indexes per-provider rates but never needed a context window. The dashboard
 * statusline's `ctx ~Xk/Yk` cell wants `Y` (the resolved orchestrator
 * model's context window) reactively, so the table lives at L0 (`@swt-labs/
 * shared`) where every layer can import it — runtime + orchestration are free
 * to consume it later if a use case shows up.
 *
 * Convention: keys are the canonical model id strings the orchestrator
 * resolves at spawn time (the same strings that surface on the
 * `cook.provider_selected.model` event field added in commit f95441b /
 * step 1). Values are the **total** model context window in tokens
 * (input + output budget combined — the dashboard's estimate compares
 * cumulative session input against this).
 *
 * Unknown models return `null` → the statusline renders `—/—`.
 *
 * Scope (per artifacts.md §D): cover the model ids currently referenced
 * across the SWT codebase — Anthropic 4.x family, OpenAI Codex/GPT-5
 * family, and a few ollama community models the test fixtures use.
 * Extend as new ids appear in `agents/*.md`, `provider_overlays/*.md`,
 * or test cassettes; an unlisted id is not a bug, it just shows `—`.
 */

/**
 * Hardcoded table of `{ context_window }` per known model id.
 *
 * Numbers are documented vendor-published context-window sizes at the time
 * of writing (May 2026). Tightly-coupled to vendor docs; refresh when
 * vendor announcements change. NOT a precision-critical surface — the
 * statusline rounds to `Nk` for display.
 */
const CONTEXT_WINDOW_BY_MODEL: Readonly<Record<string, number>> = {
  // ── Anthropic Claude 4.x ────────────────────────────────────────────
  // Standard window: 200k. The 1M-context variants ship as suffix-tagged
  // model ids (e.g. `claude-opus-4-7[1m]`) — list both shapes so the
  // suffix doesn't fall through to `null`.
  'claude-opus-4-7': 200_000,
  'claude-opus-4-7[1m]': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-6[1m]': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // ── OpenAI Codex / GPT-5 family ─────────────────────────────────────
  // Codex CLI models published by OpenAI for SWT's `backend: codex` path.
  // GPT-5 family ships with 400k context (per the May 2026 announcement);
  // the Codex-specific tunings inherit the same window.
  'gpt-5': 400_000,
  'gpt-5-mini': 400_000,
  'gpt-5-nano': 400_000,
  'gpt-5-codex': 400_000,
  // ── Ollama community models (test cassettes / dev fixtures) ─────────
  // Ollama runs whatever the user has pulled; SWT test fixtures reference
  // Llama 3.1 (128k) and Qwen2.5-Coder (32k base, 128k extended). The
  // table only needs entries the orchestrator might actually emit — extend
  // when a new ollama model id starts appearing on cook.provider_selected.
  'llama3.1:8b': 128_000,
  'llama3.1:70b': 128_000,
  'qwen2.5-coder:32b': 128_000,
};

/**
 * Resolve the context window for a model id.
 *
 * Returns the token count when the id is known. Returns `null` for
 * unknown ids, empty strings, null, and undefined — the dashboard
 * statusline reads `null` as "render `—`".
 *
 * Pure function; no side effects, no IO, safe to call in tight loops.
 */
export function getContextWindow(modelId: string | null | undefined): number | null {
  if (modelId === null || modelId === undefined) return null;
  if (modelId.length === 0) return null;
  return CONTEXT_WINDOW_BY_MODEL[modelId] ?? null;
}

/**
 * Read-only view of the underlying table. Exposed so consumers can
 * enumerate known ids (e.g. for completeness assertions in tests) without
 * exposing a mutable handle. Do not depend on iteration order; the table
 * is keyed by string and JS object iteration order is not part of this
 * module's contract.
 */
export const KNOWN_MODEL_IDS: ReadonlyArray<string> = Object.freeze(
  Object.keys(CONTEXT_WINDOW_BY_MODEL),
);
