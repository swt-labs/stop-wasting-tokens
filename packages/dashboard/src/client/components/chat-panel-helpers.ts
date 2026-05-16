/**
 * Plan 03-02 (milestone 12, Phase 03) — pure render helpers for `ChatPanel`.
 *
 * Milestone 13 / Phase 01 — DEPRECATED. Both this module and its sibling
 * `ChatPanel.tsx` are scheduled for deletion in Plan 01-05 once
 * `UnifiedLogPanel` replaces the dual-panel split. The transitional adapter
 * in `App.tsx` keeps `ChatPanel` mounted under the legacy `<Show>` branch;
 * the `ChatSession` interface that used to be exported from
 * `dashboard-store.ts` is gone, so the helpers inline a minimal local shape
 * just to satisfy the legacy `shouldDisableClear` signature. Do NOT add new
 * consumers — write against `unified-log-helpers.ts` instead.
 */
import type { ChatStatus } from '../state/dashboard-store.js';

/** Legacy local shape — replaced by `chatStreaming` + `chatStatus` at state level. */
export interface LegacyChatSession {
  streaming: boolean;
  status: ChatStatus;
}

/**
 * CSS class string for a chat message row. The component renders
 *   `<div class={chatMsgClass(msg.role)}>...</div>`
 * to get the two-token `chat-msg chat-msg-{role}` selector pair styled in
 * styles.css. Keeping the literal here (not inlined in JSX) lets the helper
 * stay testable and keeps the role→class mapping in one place.
 */
export function chatMsgClass(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-assistant';
}

/**
 * Token-usage badge text for an assistant message. Renders as
 *   `↑{input} ↓{output}`
 * — the up-arrow conveys "tokens flowing TO the model" and the down-arrow
 * "tokens flowing FROM the model", matching the dashboard's existing
 * metering vocabulary. `cacheRead` / `cacheWrite` / `provider` / `model`
 * from the 6-field `ChatMessage.usage` payload are intentionally NOT
 * surfaced in this badge — the badge stays compact; richer details belong
 * to a future hover/details affordance (Phase 04).
 */
export function formatUsage(usage: { input: number; output: number }): string {
  return `↑${usage.input} ↓${usage.output}`;
}

/**
 * Tool-call inline annotation text. The panel renders each entry of
 * `message.tools_called[]` as a `<span class="chat-msg-tool-call">`
 * containing this string. The bracketed `[tool: name]` shape matches the
 * cook log's existing tool-trace vocabulary so users moving between modes
 * see consistent affordances.
 */
export function buildToolAnnotation(toolName: string): string {
  return `[tool: ${toolName}]`;
}

/**
 * Whether the panel's "Clear conversation" button should be disabled.
 * Mirrors `ChatSession.streaming` directly — a streaming turn is mid-flight
 * and clearing it would orphan the SSE event stream against a null
 * `state.chatSession` (the correlation guard in `handleChatEvent` would
 * then drop every remaining `chat.*` event). Once `chat.complete` flips
 * streaming false the button re-enables.
 *
 * The narrow `Pick`-style param shape (rather than `ChatSession`) keeps the
 * helper trivially testable without constructing a full session object.
 */
export function shouldDisableClear(session: Pick<LegacyChatSession, 'streaming'>): boolean {
  return session.streaming === true;
}
