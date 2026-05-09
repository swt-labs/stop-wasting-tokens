import { For, Show, createSignal, onMount, type Component } from 'solid-js';

import type { VibeReplyBody } from '@swt-labs/dashboard-core';

import { ansiToHtml } from '../lib/ansi-to-html.js';
import type { ConversationEntry } from '../state/dashboard-store.js';

export interface LogLine {
  id: string;
  ts: string;
  channel: 'stdout' | 'stderr';
  line: string;
}

export interface LogPanelProps {
  lines: readonly LogLine[];
  conversation?: readonly ConversationEntry[];
  replying?: boolean;
  onReply?: (answer: VibeReplyBody['answer']) => Promise<boolean>;
}

const PERMISSION_OPERATION_VERB: Record<string, string> = {
  shell: 'run a shell command',
  network: 'make an HTTP request to',
  write_file: 'write a file outside your project',
  read_file: 'read a file outside your home directory',
  mcp_action: 'invoke an MCP tool',
};

export const LogPanel: Component<LogPanelProps> = (props) => {
  let scrollerRef: HTMLDivElement | undefined;
  const [followLive, setFollowLive] = createSignal(true);

  const onScroll = (event: Event): void => {
    const el = event.currentTarget as HTMLDivElement;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    setFollowLive(distanceFromBottom < 24);
  };

  const jumpToLive = (): void => {
    if (scrollerRef) {
      scrollerRef.scrollTop = scrollerRef.scrollHeight;
      setFollowLive(true);
    }
  };

  onMount(() => {
    if (scrollerRef) scrollerRef.scrollTop = scrollerRef.scrollHeight;
  });

  const scheduleSnap = (): void => {
    if (followLive() && scrollerRef) {
      queueMicrotask(() => {
        if (scrollerRef && followLive()) {
          scrollerRef.scrollTop = scrollerRef.scrollHeight;
        }
      });
    }
  };

  const isEmpty = (): boolean => {
    const conv = props.conversation ?? [];
    return props.lines.length === 0 && conv.length === 0;
  };

  return (
    <section class="panel log-panel" aria-label="Log Panel">
      <h2 class="panel-header">Log</h2>
      <div ref={scrollerRef} class="log-panel-scroller" onScroll={onScroll}>
        {scheduleSnap()}
        <Show
          when={!isEmpty()}
          fallback={<div class="preview-panel-empty">No log lines yet.</div>}
        >
          <Show when={(props.conversation ?? []).length > 0}>
            <div class="conversation-thread" aria-label="Vibe conversation">
              <For each={props.conversation ?? []}>
                {(entry) => (
                  <ConversationCard
                    entry={entry}
                    replying={props.replying ?? false}
                    onReply={props.onReply}
                  />
                )}
              </For>
            </div>
          </Show>
          <For each={props.lines}>
            {(line) => (
              <div class="log-panel-line" data-channel={line.channel}>
                <span class="log-panel-ts">{line.ts.slice(11, 19)}</span>
                <span class="log-panel-text" innerHTML={ansiToHtml(line.line)} />
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={!followLive()}>
        <button type="button" class="log-panel-jump-pill" onClick={jumpToLive}>
          ↓ jump to live
        </button>
      </Show>
    </section>
  );
};

interface ConversationCardProps {
  entry: ConversationEntry;
  replying: boolean;
  onReply?: (answer: VibeReplyBody['answer']) => Promise<boolean>;
}

const ConversationCard: Component<ConversationCardProps> = (props) => {
  const [textValue, setTextValue] = createSignal('');
  const isPermission = (): boolean => props.entry.subtype === 'permission';

  const submitChoice = async (value: string): Promise<void> => {
    if (!props.onReply) return;
    await props.onReply({ kind: 'choice', value });
  };

  const submitFreeForm = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (!props.onReply) return;
    const text = textValue().trim();
    if (text.length === 0) return;
    setTextValue('');
    await props.onReply({ kind: 'free_form', text });
  };

  const submitPermission = async (
    decision: 'once' | 'session' | 'deny',
  ): Promise<void> => {
    if (!props.onReply) return;
    const note = textValue().trim();
    await props.onReply({
      kind: 'permission',
      decision,
      ...(note.length > 0 ? { user_note: note } : {}),
    });
  };

  return (
    <div
      class="conversation-card"
      data-subtype={props.entry.subtype}
      data-status={props.entry.status}
    >
      <div class="conversation-card-header">
        <Show when={isPermission()}>
          <span class="conversation-card-icon" aria-label="permission required">
            ⌘
          </span>
          <span class="conversation-card-label">REQUIRES APPROVAL</span>
        </Show>
        <Show when={!isPermission()}>
          <span class="conversation-card-label conversation-card-label-clarification">
            agent asks
          </span>
        </Show>
        <Show when={props.entry.status === 'expired'}>
          <span class="conversation-card-status">expired</span>
        </Show>
        <Show when={props.entry.status === 'answered'}>
          <span class="conversation-card-status">answered</span>
        </Show>
      </div>
      <div class="conversation-card-question">{props.entry.question}</div>
      <Show when={isPermission() && props.entry.context?.target}>
        <div class="conversation-card-target">
          <span class="conversation-card-target-verb">
            {PERMISSION_OPERATION_VERB[props.entry.context?.operation ?? ''] ?? 'perform'}:
          </span>{' '}
          <code class="conversation-card-target-value">{props.entry.context?.target}</code>
        </div>
      </Show>
      <Show when={isPermission() && props.entry.context?.risk_summary}>
        <div class="conversation-card-risk">{props.entry.context?.risk_summary}</div>
      </Show>

      <Show when={props.entry.status === 'pending'}>
        <Show when={!isPermission() && (props.entry.options?.length ?? 0) > 0}>
          <div class="conversation-card-options">
            <For each={props.entry.options ?? []}>
              {(opt) => (
                <button
                  type="button"
                  class="conversation-card-option-btn"
                  disabled={props.replying}
                  onClick={() => void submitChoice(opt.value)}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={!isPermission() && (props.entry.options?.length ?? 0) === 0}>
          <form class="conversation-card-reply-form" onSubmit={(e) => void submitFreeForm(e)}>
            <input
              type="text"
              class="conversation-card-reply-input"
              placeholder="Type your reply…"
              value={textValue()}
              onInput={(e) => setTextValue((e.currentTarget as HTMLInputElement).value)}
              disabled={props.replying}
              autofocus
            />
            <button type="submit" class="conversation-card-reply-submit" disabled={props.replying}>
              Send
            </button>
          </form>
        </Show>
        <Show when={isPermission()}>
          <div class="conversation-card-permission-controls">
            <input
              type="text"
              class="conversation-card-permission-note"
              placeholder="Optional note for the agent…"
              value={textValue()}
              onInput={(e) => setTextValue((e.currentTarget as HTMLInputElement).value)}
              disabled={props.replying}
            />
            <div class="conversation-card-permission-buttons">
              <button
                type="button"
                class="conversation-card-permission-btn"
                data-decision="once"
                disabled={props.replying}
                onClick={() => void submitPermission('once')}
              >
                Approve once
              </button>
              <button
                type="button"
                class="conversation-card-permission-btn"
                data-decision="session"
                disabled={props.replying}
                onClick={() => void submitPermission('session')}
              >
                Approve for session
              </button>
              <button
                type="button"
                class="conversation-card-permission-btn"
                data-decision="deny"
                disabled={props.replying}
                onClick={() => void submitPermission('deny')}
              >
                Deny
              </button>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={props.entry.status === 'answered' && props.entry.reply !== undefined}>
        <div class="conversation-card-reply-summary">
          <span class="conversation-card-reply-arrow">↳</span>{' '}
          <ReplySummary reply={props.entry.reply!} />
        </div>
      </Show>
    </div>
  );
};

const ReplySummary: Component<{ reply: VibeReplyBody['answer'] }> = (props) => {
  const reply = props.reply;
  if (reply.kind === 'free_form') return <span>{reply.text}</span>;
  if (reply.kind === 'choice') return <span>{reply.value}</span>;
  return (
    <span>
      <span data-decision={reply.decision}>{reply.decision}</span>
      <Show when={reply.user_note}>
        <span class="conversation-card-reply-note"> — {reply.user_note}</span>
      </Show>
    </span>
  );
};
