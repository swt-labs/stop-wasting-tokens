/**
 * Milestone 13 / Phase 01 — pure helpers for `UnifiedLogPanel`.
 *
 * Why a separate module?
 *   The dashboard vitest harness runs `environment: 'node'` with an esbuild
 *   transform that cannot emit Solid-compatible JSX runtime calls (mirrors the
 *   `chat-panel-helpers.ts` precedent at packages/dashboard/test/chat-panel.test.ts:6-15).
 *   Component render-tests are therefore out of scope; the load-bearing logic
 *   — lane classification, timestamp formatting, monospace-line rendering,
 *   chat-only filtering, clear-button gating — is factored into these pure
 *   helpers and unit-tested directly against the return values.
 *
 * All helpers are pure functions over `LogEntry` / primitives. Zero DOM, zero
 * Solid imports, zero side effects. The panel component owns scroll geometry
 * + event wiring; this module owns the data-shape transforms.
 *
 * Helper names are the five canonical ones from ROADMAP success criterion #7;
 * Scout's research-time aliases (shouldShowClearButton / buildLogEntryClass /
 * formatLogEntryTimestamp / isStreamingEntry) collapse into this set.
 */

import type { LogEntry } from '@swt-labs/shared';

/**
 * Map a `LogEntry` to the visual "lane" the renderer should use. The four
 * lanes correspond to the styling clusters in `01-RESEARCH.md` §1 + §5:
 *   - 'chat'   — bubble layout (user-right / assistant-left)
 *   - 'cook'   — orchestrator output (cook-status, cook-agent, cook-tool,
 *                cook-ask-user grouped together so verb-chip switching does
 *                not reorder the visual lane)
 *   - 'init'   — init bootstrap lines (own lane, dimmer than cook)
 *   - 'system' — log.append SSE + appendLogLine() bookkeeping (monospace)
 *
 * Per Scout §1 K-2, `cook-ask-user` is treated as a cook-lane entry in
 * Phase 01 (a placeholder line until Phase 03 swaps in an interactive card).
 */
export function classifyEntry(entry: LogEntry): 'chat' | 'cook' | 'init' | 'system' {
  switch (entry.kind) {
    case 'chat-user':
    case 'chat-assistant':
    case 'chat-error':
      return 'chat';
    case 'cook-status':
    case 'cook-agent':
    case 'cook-tool':
    case 'cook-ask-user':
      return 'cook';
    case 'init':
      return 'init';
    case 'system':
      return 'system';
  }
}

/**
 * Slice an ISO-8601 timestamp to `HH:MM:SS`. Mirrors `LogPanel.tsx:121`'s
 * `line.ts.slice(11, 19)` policy — fast and zero-locale-dependent. Malformed
 * input (anything that does not contain `THH:MM:SS` at offset 10) falls back
 * to the empty string rather than throwing, so the renderer never crashes on
 * a synthetic test fixture.
 *
 * Defined policy:
 *   - Valid ISO-8601 (`YYYY-MM-DDTHH:MM:SS…`)        → `'HH:MM:SS'`
 *   - String shorter than 19 chars                    → `''`
 *   - String with non-`T` separator at index 10       → `''`
 *   - Empty / non-string-shaped input (never happens at runtime; TS enforces)
 */
export function formatTimestamp(ts: string): string {
  if (typeof ts !== 'string' || ts.length < 19 || ts.charAt(10) !== 'T') return '';
  return ts.slice(11, 19);
}

/**
 * Render a single inline string for every `LogEntry` kind. Used by the
 * panel's `<For>` body to produce the canonical `HH:MM:SS [kind] message`
 * line. Milestone 16 / Phase 01 folded chat-user / chat-assistant / chat-error
 * into the unified monospace feed, so this helper is now total over
 * `LogEntry` AND load-bearing for chat rendering.
 *
 * Shape per Scout §1 examples:
 *   - init           → `'14:23:45 [init] Lead detecting stack…'`
 *   - cook-status    → `'14:23:45 [cook] started session 12345678 — "fix the bug"'`
 *   - cook-tool      → `'14:23:45 [cook] tool: Read packages/shared/...'`
 *   - cook-agent     → `'14:23:45 [cook] agent dev spawn (sub-abcd1234)'`
 *   - system         → `'14:23:45 [system] [internal] [chat] conversation cleared'`
 *   - chat-user      → `'14:23:45 [chat-user] hi'`
 *   - chat-assistant → `'14:23:45 [chat-assistant] hello back [tool: Read] ↑12 ↓34'`
 *                      (tools_called + usage suffixes are inlined when present;
 *                      omitted when absent)
 *   - chat-error     → `'14:23:45 [chat-error] CHAT_AUTH_FAILED: <message>'`
 */
export function entryToLine(entry: LogEntry): string {
  const ts = formatTimestamp(entry.ts);
  const prefix = ts.length > 0 ? `${ts} ` : '';
  switch (entry.kind) {
    case 'init':
      return `${prefix}[init] ${entry.message}`;
    case 'cook-status':
      return `${prefix}[cook] ${entry.message}`;
    case 'cook-tool': {
      const detail =
        entry.event === 'call'
          ? entry.input_excerpt
            ? `${entry.tool} ${entry.input_excerpt}`
            : entry.tool
          : entry.result_excerpt
            ? `${entry.tool} → ${entry.result_excerpt}`
            : `${entry.tool} → (done)`;
      return `${prefix}[cook] tool: ${detail}`;
    }
    case 'cook-agent': {
      const role = entry.role;
      const sub = entry.sub_session_id.slice(0, 8);
      if (entry.event === 'spawn') {
        return `${prefix}[cook] agent ${role} spawn (${sub})`;
      }
      const status = entry.result_status ?? 'result';
      const cost = typeof entry.cost_usd === 'number' ? ` $${entry.cost_usd.toFixed(4)}` : '';
      const elapsed = typeof entry.elapsed_ms === 'number' ? ` ${entry.elapsed_ms}ms` : '';
      return `${prefix}[cook] agent ${role} ${status} (${sub})${cost}${elapsed}`;
    }
    case 'cook-ask-user':
      return `${prefix}[cook-ask-user] ${entry.question}`;
    case 'system': {
      const channelTag = entry.channel === 'internal' ? '[internal] ' : '';
      return `${prefix}[system] ${channelTag}${entry.line}`;
    }
    case 'chat-user':
      return `${prefix}[chat-user] ${entry.text}`;
    case 'chat-assistant': {
      const tools =
        (entry.tools_called?.length ?? 0) > 0
          ? ` [tool: ${(entry.tools_called ?? []).join(', tool: ')}]`
          : '';
      const usage = entry.usage ? ` ↑${entry.usage.input} ↓${entry.usage.output}` : '';
      return `${prefix}[chat-assistant] ${entry.text}${tools}${usage}`;
    }
    case 'chat-error':
      return `${prefix}[chat-error] ${entry.code}: ${entry.message}`;
  }
}

/**
 * Filter a `LogEntry[]` to only the chat-lane subset, preserving order.
 * Consumers (e.g. an optional chat-only filter in `UnifiedLogPanel`) can use
 * this to show a chat-only view without mutating the canonical log.
 */
export function filterChatEntries(log: LogEntry[]): LogEntry[] {
  return log.filter(
    (entry) =>
      entry.kind === 'chat-user' || entry.kind === 'chat-assistant' || entry.kind === 'chat-error',
  );
}

/**
 * Whether the "Clear conversation" button should be DISABLED.
 *
 * Two conditions force disable:
 *   1. There is nothing to clear — `unifiedLog` contains zero chat-lane
 *      entries. Clearing would be a no-op.
 *   2. A chat turn is currently streaming. Mid-stream clear orphans the SSE
 *      event stream against a null `chat_session_id`, and the correlation
 *      guard in `handleChatEvent` would then drop every remaining `chat.*`
 *      event. Wait for `chat.complete` to flip `chatStreaming` false.
 *
 * Returns `true` when the button should be disabled (and visually hidden if
 * the caller prefers a no-affordance UX). Returns `false` when the button is
 * actionable.
 */
export function shouldDisableClear(log: LogEntry[], chatStreaming: boolean): boolean {
  if (chatStreaming) return true;
  return !log.some(
    (entry) =>
      entry.kind === 'chat-user' || entry.kind === 'chat-assistant' || entry.kind === 'chat-error',
  );
}
