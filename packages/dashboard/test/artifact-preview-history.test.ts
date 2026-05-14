/**
 * Plan 04-03 T4 — coverage for `<ArtifactPreview>` History tab API contract.
 *
 * The history + diff resources call into `fetchArtifactHistory` /
 * `fetchArtifactDiff` from `services/api.ts`. We exercise those service
 * helpers directly to lock the URL shape against the routes plan 04-02
 * shipped (`/api/artifact-history`, `/api/artifact-diff`). Full DOM render
 * of the tab interactions is deferred to plan 04-05's e2e smoke.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactPreview } from '../src/client/components/ArtifactPreview.jsx';
import { fetchArtifactDiff, fetchArtifactHistory } from '../src/client/services/api.js';

let fetchSpy!: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchArtifactHistory', () => {
  it('hits /api/artifact-history with encoded path + clamped limit', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        commits: [
          { sha: 'a'.repeat(40), message: 'fix: x', author: 'Tia', date: '2026-05-13T10:00:00Z' },
        ],
      }),
    );

    const commits = await fetchArtifactHistory('04-dashboard-statusline', '04-03-PLAN.md', 5);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      '/api/artifact-history?path=.swt-planning%2Fphases%2F04-dashboard-statusline%2F04-03-PLAN.md&limit=5',
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]!.message).toBe('fix: x');
  });

  it('throws when the response is missing commits[]', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ bogus: true }));
    await expect(fetchArtifactHistory('04', 'foo.md')).rejects.toThrow(/missing commits/);
  });
});

describe('fetchArtifactDiff', () => {
  it('hits /api/artifact-diff with encoded path + base ref', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ diff: '+ hello\n- world\n' }));

    const diff = await fetchArtifactDiff('04', '04-03-PLAN.md', 'abc123');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      '/api/artifact-diff?path=.swt-planning%2Fphases%2F04%2F04-03-PLAN.md&base=abc123',
    );
    expect(diff).toContain('+ hello');
  });

  it('throws when the response is missing diff string', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await expect(fetchArtifactDiff('04', 'foo.md', 'sha')).rejects.toThrow(/missing diff/);
  });
});

describe('<ArtifactPreview>', () => {
  it('exports a Solid component function', () => {
    expect(typeof ArtifactPreview).toBe('function');
  });
});
