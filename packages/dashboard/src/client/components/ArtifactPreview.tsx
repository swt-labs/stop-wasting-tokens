import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';

import {
  fetchArtifactDiff,
  fetchArtifactHistory,
  type ArtifactHistoryCommit,
  type RenderedArtifact,
} from '../services/api.js';

export type ArtifactPreviewTab = 'preview' | 'history';

export interface ArtifactPreviewProps {
  selected: { phase: string; name: string } | null;
  rendered: RenderedArtifact | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /**
   * Injected for unit testing — production callers fall back to the real
   * `/api/artifact-history` + `/api/artifact-diff` services.
   */
  fetchHistory?: (phase: string, name: string, limit?: number) => Promise<ArtifactHistoryCommit[]>;
  fetchDiff?: (phase: string, name: string, base: string) => Promise<string>;
}

const PARAGRAPH_PAGE_SIZE = 500;

function splitParagraphs(html: string): string[] {
  // Split rendered HTML on closing </p> boundaries. The trailing fragment
  // (anything after the last </p>) is preserved as its own chunk so non-<p>
  // tail content (lists, code blocks, etc.) still renders.
  if (!html) return [];
  const closer = '</p>';
  const out: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const next = html.indexOf(closer, cursor);
    if (next === -1) {
      const tail = html.slice(cursor);
      if (tail.trim().length > 0) out.push(tail);
      break;
    }
    out.push(html.slice(cursor, next + closer.length));
    cursor = next + closer.length;
  }
  return out;
}

function frontmatterEntries(fm: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(fm).map(([k, v]) => [k, formatValue(v)]);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

export const ArtifactPreview: Component<ArtifactPreviewProps> = (props) => {
  const [pageCount, setPageCount] = createSignal(1);
  const [tab, setTab] = createSignal<ArtifactPreviewTab>('preview');
  const [selectedCommit, setSelectedCommit] = createSignal<string | null>(null);

  const paragraphs = createMemo(() => (props.rendered ? splitParagraphs(props.rendered.html) : []));
  const visibleHtml = createMemo(() => {
    const all = paragraphs();
    const cap = pageCount() * PARAGRAPH_PAGE_SIZE;
    if (all.length <= cap) return props.rendered?.html ?? '';
    return all.slice(0, cap).join('');
  });
  const remaining = createMemo(() =>
    Math.max(0, paragraphs().length - pageCount() * PARAGRAPH_PAGE_SIZE),
  );

  // History tab — fire only when (selected, tab=history). 404s and other
  // route failures surface as an inline error message rather than blowing
  // up the Preview tab.
  const historySource = createMemo(() =>
    tab() === 'history' && props.selected ? { ...props.selected } : null,
  );
  const [history] = createResource<ArtifactHistoryCommit[], { phase: string; name: string } | null>(
    historySource,
    async (sel) => {
      if (!sel) return [];
      // Reset commit selection when the artifact path changes.
      setSelectedCommit(null);
      const fetch = props.fetchHistory ?? fetchArtifactHistory;
      return fetch(sel.phase, sel.name, 10);
    },
  );

  const diffSource = createMemo(() => {
    const sel = props.selected;
    const sha = selectedCommit();
    if (!sel || !sha || tab() !== 'history') return null;
    return { phase: sel.phase, name: sel.name, sha };
  });
  const [diff] = createResource<
    string,
    { phase: string; name: string; sha: string } | null
  >(diffSource, async (target) => {
    if (!target) return '';
    const fetch = props.fetchDiff ?? fetchArtifactDiff;
    return fetch(target.phase, target.name, target.sha);
  });

  return (
    <section class="panel preview-panel" aria-label="Artifact preview">
      <header class="preview-panel-header">
        <h2 class="panel-header">Preview</h2>
        <Show when={props.selected}>
          <div class="preview-panel-meta">
            <span>{props.selected!.phase}</span>
            <span class="topbar-sep">/</span>
            <span>{props.selected!.name}</span>
          </div>
        </Show>
        <Show when={props.selected}>
          <div class="preview-panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="preview-panel-tab"
              classList={{ active: tab() === 'preview' }}
              aria-selected={tab() === 'preview'}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              class="preview-panel-tab"
              classList={{ active: tab() === 'history' }}
              aria-selected={tab() === 'history'}
              onClick={() => setTab('history')}
            >
              History
            </button>
          </div>
        </Show>
      </header>

      <Show
        when={props.selected}
        fallback={
          <div class="preview-panel-empty">Select an artifact in the tree to preview it.</div>
        }
      >
        <Show when={tab() === 'preview'}>
          <Show when={!props.loading} fallback={<div class="preview-panel-loading">Loading…</div>}>
            <Show
              when={!props.error}
              fallback={
                <div class="preview-panel-error">
                  <p>Error: {props.error}</p>
                  <button type="button" onClick={() => props.onRetry()}>
                    Retry
                  </button>
                </div>
              }
            >
              <Show when={props.rendered}>
                <Show when={Object.keys(props.rendered!.frontmatter).length > 0}>
                  <table class="preview-panel-frontmatter">
                    <tbody>
                      <For each={frontmatterEntries(props.rendered!.frontmatter)}>
                        {([k, v]) => (
                          <tr>
                            <th>{k}</th>
                            <td>{v}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <div class="preview-panel-body" innerHTML={visibleHtml()} />
                <Show when={remaining() > 0}>
                  <button
                    type="button"
                    class="preview-panel-loadmore"
                    onClick={() => setPageCount((n) => n + 1)}
                  >
                    Show paragraphs {pageCount() * PARAGRAPH_PAGE_SIZE + 1}–
                    {Math.min(paragraphs().length, (pageCount() + 1) * PARAGRAPH_PAGE_SIZE)} of{' '}
                    {paragraphs().length}
                  </button>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
        <Show when={tab() === 'history'}>
          <Show
            when={!history.loading}
            fallback={<div class="preview-panel-loading">Loading history…</div>}
          >
            <Show
              when={!history.error}
              fallback={
                <div class="preview-panel-error">
                  <p>Error: {(history.error as Error)?.message ?? 'history fetch failed'}</p>
                </div>
              }
            >
              <Show
                when={(history() ?? []).length > 0}
                fallback={<div class="preview-panel-empty">No commits found for this artifact.</div>}
              >
                <ul class="preview-history-list" role="list">
                  <For each={history()}>
                    {(commit) => (
                      <li
                        class="preview-history-item"
                        classList={{ selected: selectedCommit() === commit.sha }}
                      >
                        <button
                          type="button"
                          class="preview-history-button"
                          onClick={() => setSelectedCommit(commit.sha)}
                        >
                          <code class="preview-history-sha">{commit.sha.slice(0, 7)}</code>
                          <span class="preview-history-msg">{commit.message}</span>
                          <span class="preview-history-meta">
                            {commit.author} · {commit.date.slice(0, 10)}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={selectedCommit()}>
                  <Show
                    when={!diff.loading}
                    fallback={<div class="preview-panel-loading">Loading diff…</div>}
                  >
                    <Show
                      when={!diff.error}
                      fallback={
                        <div class="preview-panel-error">
                          <p>Error: {(diff.error as Error)?.message ?? 'diff fetch failed'}</p>
                        </div>
                      }
                    >
                      <pre class="preview-history-diff">{diff() ?? ''}</pre>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
};
