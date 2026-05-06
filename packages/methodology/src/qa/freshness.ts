import { readVerification } from '@swt-labs/artifacts';

import { checkQaFreshness as checkSnapshotFreshness } from '../state/qa-freshness.js';

export type HandlerQaStatus = 'passed' | 'remediated' | 'pending' | 'failed';

export interface HandlerQaFreshnessInput {
  readonly phaseDir: string;
  readonly phase: string;
  readonly cwd: string;
  readonly gitBin?: string;
  readonly allowGit?: boolean;
}

export interface HandlerQaFreshnessResult {
  readonly status: HandlerQaStatus;
  readonly reason: string;
  readonly verifiedAtCommit: string | undefined;
}

/**
 * Handler-side freshness check: reads VERIFICATION.md off disk, compares its
 * `verified_at_commit` against HEAD via git rev-parse, and returns the qa_status
 * label phase-detect would emit.
 */
export async function checkQaFreshness(
  input: HandlerQaFreshnessInput,
): Promise<HandlerQaFreshnessResult> {
  let doc: Awaited<ReturnType<typeof readVerification>> | undefined;
  try {
    doc = await readVerification(input.phaseDir, input.phase);
  } catch {
    doc = undefined;
  }

  const snapshot =
    doc === undefined
      ? undefined
      : {
          filename: `${doc.phase}-VERIFICATION.md`,
          result:
            doc.result === 'pass'
              ? ('PASS' as const)
              : doc.result === 'fail'
                ? ('FAIL' as const)
                : doc.result === 'partial'
                  ? ('PARTIAL' as const)
                  : ('unknown' as const),
          verifiedAtCommit: doc.verified_at_commit.length > 0 ? doc.verified_at_commit : undefined,
        };

  const freshness = await checkSnapshotFreshness({
    verification: snapshot,
    cwd: input.cwd,
    ...(input.gitBin !== undefined ? { gitBin: input.gitBin } : {}),
    ...(input.allowGit !== undefined ? { allowGit: input.allowGit } : {}),
  });

  if (!freshness.hasVerification) {
    return { status: 'pending', reason: freshness.reason, verifiedAtCommit: undefined };
  }
  if (doc !== undefined && doc.result === 'fail') {
    return {
      status: 'failed',
      reason: 'verification_result_fail',
      verifiedAtCommit: snapshot?.verifiedAtCommit,
    };
  }
  if (freshness.stale) {
    if (
      freshness.reason === 'verified_at_commit_mismatch' ||
      freshness.reason === 'product_commit_unavailable' ||
      freshness.reason === 'freshness_baseline_unavailable'
    ) {
      return { status: 'pending', reason: freshness.reason, verifiedAtCommit: snapshot?.verifiedAtCommit };
    }
    return { status: 'pending', reason: freshness.reason, verifiedAtCommit: snapshot?.verifiedAtCommit };
  }
  return { status: 'passed', reason: '', verifiedAtCommit: snapshot?.verifiedAtCommit };
}
