/**
 * Plan 03-02 (milestone 12, Phase 03) — Free-talk Mode chat panel.
 *
 * Mounts in App.tsx's center-lower `<Resizable.Panel>` slot via a
 * `<Show when={state.chatSession} fallback={...}>` mode-switch (Option B
 * per Scout). When the user submits a chat turn this panel replaces the
 * log panel fallback; clearing the conversation flips back via the same
 * `<Show>`. The panel itself is read-only — the TopBar is the canonical
 * input surface for chat, so no `<input>` is rendered here in v1. The
 * single interactive control is "Clear conversation".
 *
 * Auto-scroll mirrors the log panel's `followLive` pattern (see the
 * sibling log-panel component around lines 36–65 for the canonical
 * implementation): a `createEffect` reads `props.session.messages.length`
 * to register a reactive dependency, then schedules a `queueMicrotask`
 * scroll-to-bottom when the user is within ~50px of the bottom. No
 * "jump to live" pill in v1 — defer to Phase 04.
 *
 * Per-message rendering is dumb: each `chat-msg` row dispatches to
 * `chatMsgClass(role)` for the class pair, `buildToolAnnotation(name)` for
 * tool-call inline spans, `formatUsage(usage)` for the token badge, and
 * `shouldDisableClear(session)` for the clear-button gate. All four
 * helpers live in chat-panel-helpers.ts and are unit-tested directly so
 * the panel can be import-only smoke-tested implicitly via typecheck (the
 * dashboard vitest harness runs `environment: 'node'` with no jsdom —
 * matches options-menu.test.ts / settings-section.test.ts precedent).
 *
 * `<For each={messages}>` is keyed by reference identity (Solid default);
 * we rely on `message.id` being stable per 03-01's `chatMsgSeq` counter so
 * `chat.message_delta` updates re-render only the streaming row, not the
 * whole list. `data-msg-id={msg.id}` is debuggability + future test hook.
 */
import { For, Show, createEffect, onMount } from 'solid-js';
import type { Component } from 'solid-js';

import type { ChatStatus } from '../state/dashboard-store.js';

import {
  buildToolAnnotation,
  chatMsgClass,
  formatUsage,
  shouldDisableClear,
} from './chat-panel-helpers.js';

/**
 * Milestone 13 / Phase 01 — DEPRECATED legacy shape. The canonical
 * `ChatSession` interface was deleted in Plan 01-03 when chat state was
 * hoisted to top-level `unifiedLog` + `chat_session_id` + `chatStreaming` +
 * `chatStatus`. App.tsx's transitional adapter synthesizes this shape from
 * `unifiedLog` so the legacy `<Show>` branch keeps mounting until Plan
 * 01-04 swaps in `UnifiedLogPanel`. Deleted alongside this file in Plan
 * 01-05.
 */
interface LegacyChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  completed: boolean;
  tools_called?: string[];
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    provider: string;
    model: string;
  };
  error?: { code: string; message: string };
}

interface LegacyChatSession {
  chat_session_id: string;
  started_at: string;
  messages: LegacyChatMessage[];
  streaming: boolean;
  status: ChatStatus;
}

type ChatSession = LegacyChatSession;

export interface ChatPanelProps {
  session: ChatSession;
  onClear: () => void;
}

export const ChatPanel: Component<ChatPanelProps> = (props) => {
  let scrollerRef: HTMLDivElement | undefined;

  const followLive = (): boolean => {
    if (!scrollerRef) return true;
    return scrollerRef.scrollHeight - scrollerRef.scrollTop - scrollerRef.clientHeight < 50;
  };

  const snapToBottom = (): void => {
    if (!scrollerRef) return;
    scrollerRef.scrollTop = scrollerRef.scrollHeight;
  };

  // Reactive dependency on `messages.length` triggers auto-scroll on each
  // new message. `followLive()` reads the scroller's geometry — if the user
  // has scrolled up to read history, we leave them alone (Phase 04 will add
  // a "jump to live" pill).
  createEffect(() => {
    // Touching the length here registers the reactive read.
    void props.session.messages.length;
    if (followLive()) {
      queueMicrotask(snapToBottom);
    }
  });

  onMount(() => {
    snapToBottom();
  });

  return (
    <section class="panel chat-panel" aria-label="Chat Panel">
      <header class="chat-panel-header">
        <h2 class="panel-header">Chat</h2>
        <button
          type="button"
          class="chat-panel-clear-btn"
          onClick={() => props.onClear()}
          disabled={shouldDisableClear(props.session)}
        >
          Clear conversation
        </button>
      </header>
      <div ref={scrollerRef} class="chat-panel-scroller">
        <Show
          when={props.session.messages.length > 0}
          fallback={<div class="chat-panel-empty">Ask the LLM anything to get started.</div>}
        >
          <For each={props.session.messages}>
            {(msg) => (
              <div class={chatMsgClass(msg.role)} data-msg-id={msg.id}>
                <div class="chat-msg-text">{msg.text}</div>
                <Show when={msg.tools_called && msg.tools_called.length > 0}>
                  <div class="chat-msg-tools">
                    <For each={msg.tools_called ?? []}>
                      {(tool) => (
                        <span class="chat-msg-tool-call">{buildToolAnnotation(tool)}</span>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={msg.usage}>
                  {(usage) => <span class="chat-msg-usage">{formatUsage(usage())}</span>}
                </Show>
                <Show when={msg.error}>
                  {(err) => (
                    <div class="chat-msg-error">
                      {err().code}: {err().message}
                    </div>
                  )}
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
};
