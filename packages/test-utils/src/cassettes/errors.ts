/**
 * Cassette diagnostic errors.
 *
 * Exported so downstream tests (Phase 5 plans 05-02 / 05-04 e2e) can
 * `import { RequestNotInCassetteError } from '@swt-labs/test-utils'`
 * and match on `err instanceof RequestNotInCassetteError` rather than
 * brittle string-prefix matching on the message.
 */

export class RequestNotInCassetteError extends Error {
  constructor(
    public readonly requestedHash: string,
    public readonly requestedBodyExcerpt: string,
    public readonly recordedHashes: readonly string[],
  ) {
    super(
      `Request not in cassette. requested_hash=${requestedHash}; ` +
        `body_excerpt=${requestedBodyExcerpt.slice(0, 200)}; ` +
        `recorded_hashes=[${recordedHashes.slice(0, 10).join(', ')}${
          recordedHashes.length > 10 ? ', ...' : ''
        }]`,
    );
    this.name = 'RequestNotInCassetteError';
  }
}

export class CassetteSeqError extends Error {
  constructor(
    public readonly expectedSeq: number,
    public readonly receivedSeq: number,
  ) {
    super(`Cassette seq out of order: expected ${expectedSeq}, got ${receivedSeq}`);
    this.name = 'CassetteSeqError';
  }
}
