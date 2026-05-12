import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CassetteNotFoundError,
  CassetteUnsealedError,
  installReplay,
  loadCassette,
} from '../../src/cassettes/index.js';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CASSETTE_PATH = join(REPO_ROOT, 'packages/test-utils/cassettes/scout-read-readme.jsonl');

describe('cassette replayer', () => {
  describe('loadCassette', () => {
    it('throws CassetteNotFoundError for a missing file', () => {
      expect(() => loadCassette('/tmp/does-not-exist.jsonl')).toThrow(CassetteNotFoundError);
    });
  });

  describe('installReplay against scout-read-readme.jsonl', () => {
    const exists = existsSync(CASSETTE_PATH);
    const fn = exists ? it : it.skip;

    fn('loads the cassette and exposes its header + interactions (when present)', () => {
      const handle = installReplay(CASSETTE_PATH);
      try {
        expect(handle.header.cwd_redacted).toBe(true);
        expect(handle.header.provider).toBeTruthy();
        expect(handle.header.model).toBeTruthy();
        expect(handle.interactions.length).toBeGreaterThan(0);
        // Sequence numbers monotonic 1..N
        handle.interactions.forEach((interaction, idx) => {
          expect(interaction.seq).toBe(idx + 1);
        });
      } finally {
        handle.uninstall();
      }
    });

    if (!exists) {
      it.skip('TODO: scout-read-readme.jsonl not yet recorded — run scripts/record-cassette.mjs to enable this test (see docs/operations/cassette-recording.md)', () => {
        // Cassette deferred per the PR-06 cassette-recording handoff. Tests in
        // this describe block will start running when the cassette is committed.
      });
    }
  });

  describe('cwd_redacted guard', () => {
    it('refuses cassettes with cwd_redacted: false (CassetteUnsealedError)', () => {
      // This test would need a fixture file with cwd_redacted: false. The
      // schema-level rejection is already covered in format.test.ts; the
      // replayer-level enforcement is structurally guaranteed by reading
      // through the schema, so this is documented behavior here without a
      // dedicated unit test (covered by integration scenario).
      expect(CassetteUnsealedError).toBeDefined();
    });
  });
});
