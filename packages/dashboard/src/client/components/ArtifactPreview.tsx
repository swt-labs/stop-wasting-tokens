import { For, Show, createMemo, createSignal, type Component } from 'solid-js';

import type { RenderedArtifact } from '../services/api.js';

export interface ArtifactPreviewProps {
  selected: { phase: string; name: string } | null;
  rendered: RenderedArtifact | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
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
      </header>

      <Show
        when={props.selected}
        fallback={
          <div class="preview-panel-empty">Select an artifact in the tree to preview it.</div>
        }
      >
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
    </section>
  );
};
