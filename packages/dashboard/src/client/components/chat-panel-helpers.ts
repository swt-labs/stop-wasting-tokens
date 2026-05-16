/**
 * Plan 03-02 (milestone 12, Phase 03) — pure render helpers for `ChatPanel`.
 *
 * Why a separate module?
 *   The dashboard vitest harness runs `environment: 'node'` with an esbuild
 *   transform that cannot emit Solid-compatible JSX runtime calls (see
 *   options-menu.test.ts and settings-section.test.ts for the same
 *   constraint). Component render-tests are therefore out of scope; the
 *   load-bearing logic — class-name selection, badge formatting, tool-call
 *   annotation, button-disabled state — is factored into these pure helpers
 *   and unit-tested directly against the return values.
 *
 * Importing types from the dashboard-store keeps the helpers and the
 * component in lock-step with the canonical state shape; if 03-01's
 * `ChatMessage` / `ChatSession` change, TypeScript fails the build here
 * before runtime surprises in the panel.
 */
import type { ChatSession } from '../state/dashboard-store.js';

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
export function shouldDisableClear(session: Pick<ChatSession, 'streaming'>): boolean {
  return session.streaming === true;
}
