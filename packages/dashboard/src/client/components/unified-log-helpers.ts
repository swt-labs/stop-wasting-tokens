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
    case 'cook-plan-update':
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
 *   - chat-user      → `'14:23:45 [User] hi'`
 *   - chat-assistant → `'14:23:45 [Opus 4.7] hello back [tool: Read] ↑12 ↓34'`
 *                      (label is the friendly model name from `usage.model` —
 *                      see friendlyModelLabel below. Falls back to `[Assistant]`
 *                      during the streaming window before `usage` lands.
 *                      tools_called + usage suffixes are inlined when present;
 *                      omitted when absent.)
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
    case 'cook-plan-update': {
      // Phase 17 plan 04-01 Task 2 — Codex parity update_plan render.
      // Single-line monospace shape:
      //   `HH:MM:SS [cook] plan: [x] step | [~] step | [ ] step`
      // matching milestone 16's monospace-uniformity discipline. Status
      // glyphs: `[x]` completed, `[~]` in_progress, `[ ]` pending. When
      // `explanation` is present, append `— <explanation>` after the
      // step list so the model's free-form context renders inline.
      const items = entry.plan
        .map((item) => {
          const icon =
            item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
          return `${icon} ${item.step}`;
        })
        .join(' | ');
      const explanationSuffix = entry.explanation ? ` — ${entry.explanation}` : '';
      return `${prefix}[cook] plan: ${items}${explanationSuffix}`;
    }
    case 'system': {
      const channelTag = entry.channel === 'internal' ? '[internal] ' : '';
      return `${prefix}[system] ${channelTag}${entry.line}`;
    }
    case 'chat-user':
      return `${prefix}[User] ${entry.text}`;
    case 'chat-assistant': {
      const tools =
        (entry.tools_called?.length ?? 0) > 0
          ? ` [tool: ${(entry.tools_called ?? []).join(', tool: ')}]`
          : '';
      const usage = entry.usage ? ` ↑${entry.usage.input} ↓${entry.usage.output}` : '';
      const speaker = friendlyModelLabel(entry.usage?.model);
      return `${prefix}[${speaker}] ${entry.text}${tools}${usage}`;
    }
    case 'chat-error':
      return `${prefix}[chat-error] ${entry.code}: ${entry.message}`;
  }
}

/**
 * Convert a raw provider model id into a friendly display name suitable
 * for the chat-assistant label in the unified log. The model id IS
 * dynamic — it comes from `entry.usage.model` populated by each turn's
 * `chat.token_usage` SSE event from Pi. This helper only handles
 * presentation; it does not pin or fix any provider.
 *
 * Pattern-matched against common vendor families:
 *
 *   - **OpenRouter** (`vendor/model[:variant]`) — strips the vendor
 *     prefix and recurses on the model part:
 *     e.g. `anthropic/claude-opus-4-7`      → `Opus 4.7`
 *          `deepseek/deepseek-v3`           → `DeepSeek V3`
 *          `openai/gpt-4o`                  → `GPT-4o`
 *
 *   - **Anthropic** (`claude-{family}-{N}-{M}[-date]`):
 *     e.g. `claude-opus-4-7`                → `Opus 4.7`
 *          `claude-sonnet-4-6`              → `Sonnet 4.6`
 *          `claude-haiku-4-5-20251001`      → `Haiku 4.5`
 *
 *   - **OpenAI** (`gpt-{ver}[-variant]` / `o{N}` reasoning models):
 *     e.g. `gpt-5`                         → `GPT-5`
 *          `gpt-5-codex`                    → `GPT-5 Codex`
 *          `gpt-5.2-codex`                  → `GPT-5.2 Codex`
 *          `o3-mini`                        → `o3 Mini`
 *
 *   - **Google Gemini** (`gemini-{ver}[-variant]`):
 *     e.g. `gemini-2.5-flash`               → `Gemini 2.5 Flash`
 *          `gemini-1.5-pro`                 → `Gemini 1.5 Pro`
 *
 *   - **DeepSeek** (`deepseek-{ver/family}`):
 *     e.g. `deepseek-v3`                   → `DeepSeek V3`
 *          `deepseek-chat`                  → `DeepSeek Chat`
 *          `deepseek-coder`                 → `DeepSeek Coder`
 *
 *   - **Moonshot Kimi** (`kimi-k{N}[-...]`):
 *     e.g. `kimi-k2-instruct`               → `Kimi K2`
 *
 *   - **Mistral** (`mistral-{family}[-{ver}]` / `mixtral-{spec}`):
 *     e.g. `mistral-large-2`                → `Mistral Large 2`
 *          `mixtral-8x22b`                  → `Mixtral 8x22b`
 *
 *   - **xAI Grok** (`grok-{N}[-variant]`):
 *     e.g. `grok-3`                        → `Grok 3`
 *          `grok-2-vision`                  → `Grok 2 Vision`
 *
 *   - **Ollama** (`ollama:{name}[:tag]`):
 *     e.g. `ollama:llama3:7b`               → `llama3`
 *
 *   - Anything else → returned verbatim (the raw model id is the truth;
 *     it just doesn't have a known pretty form), or `Assistant` when
 *     `modelId` is undefined/empty (the streaming window before
 *     `chat.token_usage` lands).
 *
 * The label appears between brackets in the unified log row:
 * `14:23:45 [Opus 4.7] hello back [tool: Read] ↑12 ↓34`.
 */
export function friendlyModelLabel(modelId: string | undefined | null): string {
  if (!modelId) return 'Assistant';

  // OpenRouter (and similar) prefix the vendor — `anthropic/claude-opus-4-7`,
  // `deepseek/deepseek-v3`, `meta-llama/llama-3.3-70b-instruct`. Strip the
  // first segment and recurse so the underlying family gets recognized.
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0 && slashIdx < modelId.length - 1) {
    // Strip any trailing `:variant` (OpenRouter free/paid suffix).
    const after = modelId.slice(slashIdx + 1).split(':')[0]!;
    return friendlyModelLabel(after);
  }

  // Anthropic: claude-{family}-{N}-{M}[-date]
  const anthropic = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(modelId);
  if (anthropic) {
    const family = anthropic[1]!.charAt(0).toUpperCase() + anthropic[1]!.slice(1);
    return `${family} ${anthropic[2]}.${anthropic[3]}`;
  }

  // OpenAI gpt-{ver}[-variant]; gpt-4o stays as `GPT-4o`.
  const openai = /^gpt-(\d+(?:\.\d+)?[a-z]?)(?:-([A-Za-z][A-Za-z0-9]*))?/.exec(modelId);
  if (openai) {
    const base = `GPT-${openai[1]}`;
    if (openai[2]) {
      const variant = openai[2].charAt(0).toUpperCase() + openai[2].slice(1).toLowerCase();
      return `${base} ${variant}`;
    }
    return base;
  }

  // OpenAI reasoning models: o3, o4, o3-mini, o4-mini, etc.
  const oReason = /^(o\d+)(?:-([A-Za-z][A-Za-z0-9]*))?/.exec(modelId);
  if (oReason) {
    const base = oReason[1]!;
    if (oReason[2]) {
      const variant = oReason[2].charAt(0).toUpperCase() + oReason[2].slice(1).toLowerCase();
      return `${base} ${variant}`;
    }
    return base;
  }

  // Google: gemini-{ver}[-variant]
  const gemini = /^gemini-(\d+(?:\.\d+)?)(?:-([A-Za-z][A-Za-z0-9]*))?/.exec(modelId);
  if (gemini) {
    const base = `Gemini ${gemini[1]}`;
    if (gemini[2]) {
      const variant = gemini[2].charAt(0).toUpperCase() + gemini[2].slice(1).toLowerCase();
      return `${base} ${variant}`;
    }
    return base;
  }

  // DeepSeek: deepseek-{family-or-version}
  const deepseek = /^deepseek-([A-Za-z0-9]+)(?:-([A-Za-z0-9]+))?/i.exec(modelId);
  if (deepseek) {
    const titleCase = (s: string): string =>
      /^v\d+$/i.test(s) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const part1 = titleCase(deepseek[1]!);
    if (deepseek[2]) {
      return `DeepSeek ${part1} ${titleCase(deepseek[2])}`;
    }
    return `DeepSeek ${part1}`;
  }

  // Moonshot Kimi: kimi-k{N}[-...]
  const kimi = /^kimi-(k\d+)/i.exec(modelId);
  if (kimi) {
    return `Kimi ${kimi[1]!.toUpperCase()}`;
  }

  // Mistral / Mixtral
  const mistral = /^(mistral|mixtral)-([A-Za-z0-9]+)(?:-([A-Za-z0-9]+))?/i.exec(modelId);
  if (mistral) {
    const vendor = mistral[1]!.charAt(0).toUpperCase() + mistral[1]!.slice(1).toLowerCase();
    const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (mistral[3]) {
      return `${vendor} ${titleCase(mistral[2]!)} ${titleCase(mistral[3]!)}`;
    }
    return `${vendor} ${titleCase(mistral[2]!)}`;
  }

  // xAI Grok: grok-{N}[-variant]
  const grok = /^grok-(\d+)(?:-([A-Za-z][A-Za-z0-9]*))?/i.exec(modelId);
  if (grok) {
    const base = `Grok ${grok[1]}`;
    if (grok[2]) {
      const variant = grok[2].charAt(0).toUpperCase() + grok[2].slice(1).toLowerCase();
      return `${base} ${variant}`;
    }
    return base;
  }

  // Ollama local: ollama:{name}[:tag]
  const ollama = /^ollama:([^:]+)/.exec(modelId);
  if (ollama) {
    return ollama[1]!;
  }

  // Unknown — pass the raw id through. The truth is the raw id; users
  // will recognize it.
  return modelId;
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
