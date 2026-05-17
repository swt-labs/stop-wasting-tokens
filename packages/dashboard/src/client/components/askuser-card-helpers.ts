/**
 * Milestone 13 / Phase 03 — pure helpers for `<AskUserCard>` + TopBar
 * answer-mode wiring.
 *
 * Why a separate module?
 *   Same constraint as Phase 01's `unified-log-helpers` and milestone-12
 *   Phase 04's `first-run-hint-helpers`: the dashboard vitest harness
 *   runs `environment: 'node'` with an esbuild transform that cannot
 *   emit Solid-compatible JSX runtime calls. The load-bearing decisions
 *   — what mode the card is in, what surface the TopBar's Enter routes
 *   to, what placeholder text to show, and whether an option carries the
 *   Phase 02 `Recommended` sentinel — are factored into these pure
 *   functions and unit-tested directly in node-env vitest.
 *
 * Purity contract:
 *   - No DOM, no Solid imports, no fetch.
 *   - Inputs: `CookAskUserEntry` (type-only) + primitives.
 *   - Outputs: enum strings + plain strings.
 *
 * VBW faithfulness anchors:
 *   - `classifyOptionStyle` honors the Phase 02 sentinel decoding
 *     (`description === 'Recommended'` is the only path to recommended;
 *     any other non-undefined description string is `default`).
 *   - `resolveSubmitTarget` encodes the mode-precedence ladder
 *     cook-ask-user > chat > vibe > command — load-bearing for TopBar
 *     answer-mode (cross-cutting #6).
 *   - `formatAskUserPlaceholder` truncates the question so a runaway
 *     long question cannot blow out the input's visual width on narrow
 *     viewports.
 */
import type { CookAskUserEntry } from '@swt-labs/shared';

/** The three render modes the `<AskUserCard>` branches on. */
export type AskUserCardMode = 'interactive' | 'answered' | 'expired';

/**
 * The four destinations a TopBar Enter-press can route to, in priority
 * order: cook-ask-user (answer mode) > chat (neutral) > vibe (cook verb)
 * > command (any other verb). `null` is reserved for "no routable
 * target" — currently unreachable from a valid TopBar state but kept on
 * the union so future no-op branches can return it explicitly.
 */
export type SubmitTarget = 'cook-ask-user' | 'chat' | 'vibe' | 'command' | null;

/**
 * Classify a `CookAskUserEntry` into its render mode. The card's
 * top-level `<Switch>` branches on this value:
 *   - `pending`  → `interactive` (option grid + Other path / textarea)
 *   - `answered` → `answered` (compact inline pair: dimmed question + ↳ reply)
 *   - `expired`  → `expired` (dimmed question + timed-out caption)
 */
export function askUserCardMode(entry: CookAskUserEntry): AskUserCardMode {
  if (entry.status === 'pending') return 'interactive';
  if (entry.status === 'answered') return 'answered';
  return 'expired';
}

/**
 * Decide where the TopBar's Enter key dispatches. Priority is locked
 * (cross-cutting #6):
 *
 *   1. `cookAwaitingUser !== null`              → `'cook-ask-user'`
 *   2. `verb === null`                          → `'chat'`
 *      (regardless of whether a chat thread already exists)
 *   3. `verb === 'cook'`                        → `'vibe'`
 *   4. `verb` is any other action verb           → `'command'`
 *
 * The `chatSessionId` argument is currently ignored once the
 * cook-ask-user gate is past — Phase 02 routes neutral-verb submits
 * through `actions.startChat`, which handles both first-turn and
 * multi-turn internally. It is kept on the signature so future
 * branching (e.g. a distinct "resume-chat" target) can flip on it
 * without a signature change.
 */
export function resolveSubmitTarget(
  cookAwaitingUser: {
    askUserId: string;
    question: string;
    options: Array<{ value: string; label: string; description?: string }>;
    allowFreeform: boolean;
  } | null,
  verb: string | null,
  chatSessionId: string | null,
): SubmitTarget {
  // Cook-ask-user wins over every other target — including a live chat
  // thread or a sticky cook-verb. This is the load-bearing invariant the
  // TopBar's onSubmit branches on first.
  if (cookAwaitingUser !== null) return 'cook-ask-user';
  void chatSessionId; // Reserved for future routing distinctions.
  if (verb === null) return 'chat';
  if (verb === 'cook') return 'vibe';
  return 'command';
}

const ASK_USER_PLACEHOLDER_PREFIX = 'Answer for cook: ';
/**
 * The maximum length the prefixed placeholder may reach before being
 * truncated with a single trailing ellipsis. Defaults to 100 chars (the
 * `formatAskUserPlaceholder` default) — short enough to survive on a
 * narrow viewport, long enough to convey a real question.
 */
const DEFAULT_PLACEHOLDER_MAX_LEN = 100;

/**
 * Format the TopBar placeholder for answer-mode. Returns
 * `Answer for cook: ${question}` truncated with a trailing `…` when the
 * combined string would exceed `maxLen`.
 *
 * Edge cases:
 *   - Empty question → `'Answer for cook: …'` (telegraphs the mode even
 *     when no question text is available — defensive).
 *   - Question exactly at the cap → no ellipsis.
 */
export function formatAskUserPlaceholder(
  question: string,
  maxLen: number = DEFAULT_PLACEHOLDER_MAX_LEN,
): string {
  if (question.length === 0) return `${ASK_USER_PLACEHOLDER_PREFIX}…`;
  const full = `${ASK_USER_PLACEHOLDER_PREFIX}${question}`;
  if (full.length <= maxLen) return full;
  // Reserve one char for the ellipsis itself.
  const sliced = full.slice(0, Math.max(ASK_USER_PLACEHOLDER_PREFIX.length, maxLen - 1));
  return `${sliced}…`;
}

/**
 * Classify an option for visual styling. Returns `'recommended'` ONLY
 * when `option.description === 'Recommended'` — the exact Phase 02
 * sentinel string (see `dashboard-store.ts:1419-1423`).
 *
 * Any other non-undefined description string (e.g. `'Fastest option'`,
 * `'Recommended for new projects'`) returns `'default'`. The contract
 * is sentinel-exact-match, not any-non-undefined-string — adding a
 * dedicated `isRecommended: boolean` field would require a Phase 01
 * schema change which Phase 03 deliberately does not make.
 */
export function classifyOptionStyle(
  option: { value: string; label: string; description?: string },
): 'recommended' | 'default' {
  return option.description === 'Recommended' ? 'recommended' : 'default';
}
