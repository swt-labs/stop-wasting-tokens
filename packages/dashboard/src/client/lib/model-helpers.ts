/**
 * Shared model-display helpers used by both `<DashboardStatusline>` and
 * `<ActiveAgentsPane>`. Lived file-private in `DashboardStatusline.tsx`
 * until the Agents-card v2 milestone needed the same trimming + compact
 * formatting; extracted here per `a_non_production_files/INDEX.md` →
 * "Shared helpers — extract first" coordination note.
 *
 * Both helpers are pure (no DOM, no side effects) — unit-testable in the
 * dashboard's node-env vitest run.
 */

/**
 * Trim a model id to a short display form. Vendor canonical ids are
 * verbose (`claude-sonnet-4-6` vs. the natural `sonnet-4-6`); the
 * statusline + agents-card crops to the family suffix to keep cells
 * narrow.
 *
 *   - `claude-sonnet-4-6`         → `sonnet-4-6`
 *   - `claude-haiku-4-5-20251001` → `haiku-4-5-20251001`
 *   - `gpt-5-codex`               → `gpt-5-codex` (no `claude-` prefix to strip)
 *   - `null` / `''`               → `—`
 *
 * Defensive: only strips the `claude-` family prefix because Anthropic
 * ids follow a consistent `claude-{family}-N-M` pattern. Other vendors
 * render as-is (the `friendlyModelLabel` helper at
 * `unified-log-helpers.ts` is the richer renderer for chat bubbles; this
 * one is the compact crop for narrow cells).
 */
export function shortModelLabel(modelId: string | null | undefined): string {
  if (modelId === null || modelId === undefined || modelId.length === 0) return '—';
  if (modelId.startsWith('claude-')) return modelId.slice('claude-'.length);
  return modelId;
}

/**
 * Compact a single token count for narrow display cells:
 *
 *   - `< 1_000`        → exact integer (`'42'`)
 *   - `1_000-999_999`  → `'12K'` (floored)
 *   - `>= 1_000_000`   → `'3M'` (floored)
 *   - `null` / `undefined` / `NaN` → `'—'`
 *
 * Floor (not round) so the displayed value never overstates the count
 * — important for cost-sensitive displays where `12999 → "13K"` could
 * mislead. Matches the statusline contract.
 */
export function compactTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K`;
  return `${Math.floor(n)}`;
}
