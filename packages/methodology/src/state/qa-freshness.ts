import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { QaFreshnessResult } from './classify-phase.js';
import type { VerificationSnapshot } from './types.js';

const execFileP = promisify(execFile);

export interface QaFreshnessInput {
  readonly verification: VerificationSnapshot | undefined;
  readonly cwd: string;
  /** Override the git binary (default 'git'). */
  readonly gitBin?: string;
  /**
   * When false, skip the git rev-parse fallback and report `freshness_baseline_unavailable`.
   * Useful for hermetic tests.
   */
  readonly allowGit?: boolean;
}

/**
 * Compare the verified_at_commit recorded in VERIFICATION.md against the
 * current product-code HEAD. Returns a freshness verdict the classifier can
 * fold into `next_phase_state`.
 */
export async function checkQaFreshness(input: QaFreshnessInput): Promise<QaFreshnessResult> {
  if (input.verification === undefined) {
    return { hasVerification: false, stale: true, reason: 'missing_verification_artifact' };
  }
  if (input.verification.result === 'unknown') {
    return {
      hasVerification: true,
      stale: true,
      reason: 'verification_result_unrecognized',
    };
  }
  if (input.verification.verifiedAtCommit === undefined) {
    // Older / hand-written verifications lack the commit baseline.
    return { hasVerification: true, stale: false, reason: '' };
  }
  if (input.allowGit === false) {
    return {
      hasVerification: true,
      stale: true,
      reason: 'freshness_baseline_unavailable',
    };
  }

  const bin = input.gitBin ?? 'git';
  let head: string;
  try {
    const { stdout } = await execFileP(bin, ['rev-parse', 'HEAD'], { cwd: input.cwd });
    head = stdout.trim();
  } catch {
    return { hasVerification: true, stale: true, reason: 'product_commit_unavailable' };
  }

  const stale = head.length > 0 && head !== input.verification.verifiedAtCommit;
  return {
    hasVerification: true,
    stale,
    reason: stale ? 'verified_at_commit_mismatch' : '',
  };
}
