import { For, Show, createSignal, onMount, type Component } from 'solid-js';

import { ansiToHtml } from '../lib/ansi-to-html.js';

export interface LogLine {
  id: string;
  ts: string;
  channel: 'stdout' | 'stderr';
  line: string;
}

export interface LogPanelProps {
  lines: readonly LogLine[];
}

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

  // After every render, if user is following live, snap to bottom.
  // We rely on Solid's reactivity: re-scroll on next microtask.
  const scheduleSnap = (): void => {
    if (followLive() && scrollerRef) {
      queueMicrotask(() => {
        if (scrollerRef && followLive()) {
          scrollerRef.scrollTop = scrollerRef.scrollHeight;
        }
      });
    }
  };

  return (
    <section class="panel log-panel" aria-label="Log Panel">
      <h2 class="panel-header">Log</h2>
      <div ref={scrollerRef} class="log-panel-scroller" onScroll={onScroll}>
        {scheduleSnap()}
        <Show
          when={props.lines.length > 0}
          fallback={<div class="preview-panel-empty">No log lines yet.</div>}
        >
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
