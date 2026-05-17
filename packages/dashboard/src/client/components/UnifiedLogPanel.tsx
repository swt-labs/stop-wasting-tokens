/**
 * Milestone 13 / Phase 01 — Unified log panel.
 * Milestone 16 / Phase 01 — chat entries now render inline in the monospace
 * feed (previous chat card / messaging-style layout removed). Per-kind
 * dispatch via `classifyEntry`
 * (see `unified-log-helpers.ts`):
 *
 *   - 'chat'  → monospace `HH:MM:SS [chat-user|chat-assistant|chat-error]
 *               <text>` line, identical typography to cook/init/system.
 *               Streaming chat-assistant entries get an opacity-pulse
 *               (`.unified-log__line--streaming`) and an appended blinking
 *               `▌` cursor (`.unified-log__cursor`) while
 *               `entry.completed === false`. chat-error lines apply
 *               `.unified-log__line--error` (foreground in danger-red).
 *               Streaming text updates land in place via Solid path-based
 *               reactivity on `entryToLine(e)` reads inside the children
 *               rendering branch.
 *   - 'cook'  → monospace `HH:MM:SS [cook] message` lines for cook-status
 *               and cook-agent; cook-tool renders as an inline chip;
 *               cook-ask-user renders as an interactive AskUserCard.
 *   - 'init'  → monospace `HH:MM:SS [init] message` line.
 *   - 'system'→ monospace `HH:MM:SS [system] ...` line; `channel='internal'`
 *               adds a dimmer modifier class; non-internal channels route
 *               through `ansiToHtml` so process ANSI escapes survive.
 *
 * The `ConversationCard` sub-component is ported wholesale from
 * `LogPanel.tsx:142-293` (Scout Cross-Cutting Finding #3) — it drives the
 * existing `vibeSession.conversation` askUser flow with clarification +
 * permission reply forms intact. Phase 03 swaps this card off
 * `vibeSession.conversation` and onto `cook-ask-user` LogEntries; Phase 01
 * leaves the wiring as-is per the milestone scope.
 *
 * Scroll model adopts LogPanel's signal-based `followLive` + `onScroll`
 * handler + "jump to live" pill (Scout §5 "Scroll-anchor behavior" — the
 * more complete of the two pre-existing models). Geometry is DOM-bound and
 * lives in this component rather than a helper.
 */

import type { LogEntry, VibeReplyBody } from '@swt-labs/shared';
import { For, Show, createEffect, createSignal, onMount, type Component } from 'solid-js';

import { ansiToHtml } from '../lib/ansi-to-html.js';
import type { ConversationEntry } from '../state/dashboard-store.js';

import { AskUserCard } from './ask-user-card.js';
import { classifyEntry, entryToLine, shouldDisableClear } from './unified-log-helpers.js';

export type AgentBackend = 'none' | 'pi';
export type ReplyingState = boolean;

export interface UnifiedLogPanelProps {
  log: LogEntry[];
  /**
   * Phase 01 keeps `vibeSession.conversation` as the askUser source for
   * the inline `ConversationCard`. Phase 03 introduced `<AskUserCard>`
   * for cook askUser LogEntries; the two card types coexist —
   * ConversationCard drives vibeSession-level prompts (init Lead
   * clarification, permission gates), AskUserCard drives
   * cook-ask-user kind log entries.
   */
  conversation: ConversationEntry[];
  replying: ReplyingState;
  chatStreaming: boolean;
  onReply: (answer: VibeReplyBody['answer']) => Promise<boolean>;
  agentBackend: AgentBackend | null;
  onClearChat: () => void;
  /**
   * Milestone 13 / Phase 03 — optional dispatch for `<AskUserCard>`.
   * When wired (via App.tsx), each cook-ask-user `<Show>` branch in the
   * row dispatcher renders an interactive card whose option-button +
   * freeform submits flow back through this callback. When omitted, the
   * card renders in display-only mode (a button click is a no-op since
   * onRespond receives an empty handler — UnifiedLogPanel keeps it
   * defensive via the optional ?. call below). The store action
   * `respondToCookAskUser` is the production wire.
   */
  onCookAskUserRespond?: (
    askUserId: string,
    response: { selectedOption: string | null; freeform: string | null },
  ) => Promise<void>;
}

const PERMISSION_OPERATION_VERB: Record<string, string> = {
  shell: 'run a shell command',
  network: 'make an HTTP request to',
  write_file: 'write a file outside your project',
  read_file: 'read a file outside your home directory',
  mcp_action: 'invoke an MCP tool',
};

export const UnifiedLogPanel: Component<UnifiedLogPanelProps> = (props) => {
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

  // Reactive read on props.log.length registers the dependency for the
  // auto-scroll effect. Without this, deltas that update an existing
  // entry in place (without growing the array) would not retrigger the
  // snap — but inline streaming wants snap-on-content-change too, so we
  // also read the last entry's identity reference below in the effect.
  createEffect(() => {
    // Touch length + last identity so any push or in-place update fires.
    void props.log.length;
    void props.log[props.log.length - 1];
    scheduleSnap();
  });

  return (
    <section class="panel unified-log" aria-label="Unified log">
      <header class="unified-log__header">
        <h2 class="panel-header">Log</h2>
        <button
          type="button"
          class="unified-log__clear-btn"
          onClick={() => props.onClearChat()}
          disabled={shouldDisableClear(props.log, props.chatStreaming)}
          title="Clear conversation"
        >
          Clear chat
        </button>
      </header>
      <div ref={scrollerRef} class="unified-log__scroller" onScroll={onScroll}>
        <Show when={props.agentBackend === 'none'}>
          <div class="unified-log__banner--no-agent-backend" role="status">
            <span aria-hidden="true">⚙</span>
            <div>
              <div>
                <strong>No agent backend configured</strong>
              </div>
              <div>
                Sessions can be created but no agent will run. To enable real agents, install the
                Codex CLI and restart with <code>SWT_VIBE_AGENT=codex swt</code>.
              </div>
            </div>
          </div>
        </Show>
        <Show
          when={props.log.length > 0 || props.conversation.length > 0}
          fallback={<div class="unified-log__empty">No log entries yet.</div>}
        >
          <For each={props.log}>
            {(entry) => (
              <UnifiedLogRow entry={entry} onCookAskUserRespond={props.onCookAskUserRespond} />
            )}
          </For>
          <Show when={props.conversation.length > 0}>
            <For each={props.conversation}>
              {(entry) => (
                <ConversationCard entry={entry} replying={props.replying} onReply={props.onReply} />
              )}
            </For>
          </Show>
        </Show>
      </div>
      <Show when={!followLive()}>
        <button type="button" class="unified-log__pill--jump-live" onClick={jumpToLive}>
          ↓ jump to live
        </button>
      </Show>
    </section>
  );
};

/**
 * Per-entry dispatcher — switches on `entry.kind` to pick the right
 * presentation (monospace line vs inline chip vs interactive card).
 * Phase 03 added the `cook-ask-user` branch — extracted from the
 * monospace `<Show>` group below — which renders `<AskUserCard>` when
 * an `onCookAskUserRespond` callback is wired. Milestone 16 / Phase 01
 * folded chat-* kinds into the monospace `<Show>` group, deleting the
 * three chat-card branches and the dead `escapeHtml` helper.
 */
interface UnifiedLogRowProps {
  entry: LogEntry;
  onCookAskUserRespond?: (
    askUserId: string,
    response: { selectedOption: string | null; freeform: string | null },
  ) => Promise<void>;
}

const UnifiedLogRow: Component<UnifiedLogRowProps> = (props) => {
  const lane = (): 'chat' | 'cook' | 'init' | 'system' => classifyEntry(props.entry);

  return (
    <>
      <Show when={props.entry.kind === 'cook-tool'}>
        {(() => {
          const e = props.entry;
          if (e.kind !== 'cook-tool') return null;
          return (
            <span class="unified-log__chip--tool" data-entry-id={e.id}>
              {entryToLine(e)}
            </span>
          );
        })()}
      </Show>
      <Show when={props.entry.kind === 'cook-ask-user'}>
        {(() => {
          const e = props.entry;
          if (e.kind !== 'cook-ask-user') return null;
          // `e` is narrowed to CookAskUserEntry by the kind guard above;
          // no cast needed (eslint @typescript-eslint/no-unnecessary-type-assertion).
          return (
            <AskUserCard
              entry={e}
              onRespond={async (body) => {
                await props.onCookAskUserRespond?.(e.prompt_id, body);
              }}
            />
          );
        })()}
      </Show>
      <Show
        when={
          props.entry.kind === 'init' ||
          props.entry.kind === 'cook-status' ||
          props.entry.kind === 'cook-agent' ||
          props.entry.kind === 'system' ||
          props.entry.kind === 'chat-user' ||
          props.entry.kind === 'chat-assistant' ||
          props.entry.kind === 'chat-error'
        }
      >
        {(() => {
          const e = props.entry;
          if (
            e.kind !== 'init' &&
            e.kind !== 'cook-status' &&
            e.kind !== 'cook-agent' &&
            e.kind !== 'system' &&
            e.kind !== 'chat-user' &&
            e.kind !== 'chat-assistant' &&
            e.kind !== 'chat-error'
          )
            return null;
          let extraClass = '';
          if (e.kind === 'system' && e.channel === 'internal') {
            extraClass = ' unified-log__line--internal';
          } else if (e.kind === 'system' && e.channel === 'stderr') {
            extraClass = ' unified-log__line--stderr';
          } else if (e.kind === 'chat-assistant' && e.completed === false) {
            extraClass = ' unified-log__line--streaming';
          } else if (e.kind === 'chat-error') {
            extraClass = ' unified-log__line--error';
          }
          // Split the render branch on system + non-internal: that path keeps
          // `innerHTML` so process ANSI escapes route through `ansiToHtml`.
          // Everything else (init / cook-status / cook-agent / system+internal
          // / chat-*) renders via children — JSX auto-escapes text and the
          // optional streaming cursor sibling stays declarative. Solid's
          // path-based reactivity re-evaluates `entryToLine(e)` on in-place
          // mutation of `e.text` / `e.completed` without remounting the
          // surrounding `<div>` (validated by dashboard-store.chat.test.ts's
          // `chat.message_delta accumulates text` case).
          if (e.kind === 'system' && e.channel !== 'internal') {
            return (
              <div
                class={`unified-log__line--monospace${extraClass}`}
                data-entry-id={e.id}
                data-kind={e.kind}
                data-lane={lane()}
                innerHTML={`${entryToLine(e).split(e.line)[0] ?? ''}${ansiToHtml(e.line)}`}
              />
            );
          }
          return (
            <div
              class={`unified-log__line--monospace${extraClass}`}
              data-entry-id={e.id}
              data-kind={e.kind}
              data-lane={lane()}
            >
              {entryToLine(e)}
              <Show when={e.kind === 'chat-assistant' && e.completed === false}>
                <span class="unified-log__cursor" aria-hidden="true">
                  ▌
                </span>
              </Show>
            </div>
          );
        })()}
      </Show>
    </>
  );
};

/**
 * Ported wholesale from LogPanel.tsx:142-293 (Scout Cross-Cutting Finding
 * #3). Handles `clarification` + `permission` askUser subtypes with full
 * reply forms. Driven by `vibeSession.conversation` in Phase 01; Phase 03
 * swaps it onto `cook-ask-user` LogEntries.
 */
interface ConversationCardProps {
  entry: ConversationEntry;
  replying: boolean;
  onReply: (answer: VibeReplyBody['answer']) => Promise<boolean>;
}

const ConversationCard: Component<ConversationCardProps> = (props) => {
  const [textValue, setTextValue] = createSignal('');
  const isPermission = (): boolean => props.entry.subtype === 'permission';

  const submitChoice = async (value: string): Promise<void> => {
    await props.onReply({ kind: 'choice', value });
  };

  const submitFreeForm = async (e: Event): Promise<void> => {
    e.preventDefault();
    const text = textValue().trim();
    if (text.length === 0) return;
    setTextValue('');
    await props.onReply({ kind: 'free_form', text });
  };

  const submitPermission = async (decision: 'once' | 'session' | 'deny'): Promise<void> => {
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
              onInput={(e) => setTextValue(e.currentTarget.value)}
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
              onInput={(e) => setTextValue(e.currentTarget.value)}
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
