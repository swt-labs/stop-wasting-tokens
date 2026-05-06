export type MaxUatRemediationRoundsConfig = number | false | null | undefined;

export interface RoundCapDecisionInput {
  readonly maxRounds: MaxUatRemediationRoundsConfig;
  readonly currentRound: number;
}

export interface RoundCapDecision {
  readonly nextRound: number;
  readonly maxRounds: number | 'unlimited';
  readonly capReached: boolean;
}

/**
 * Mirror of VBW resolve-uat-remediation-round-limit.sh decision shape.
 * `false`/null/undefined = unlimited; positive integer = cap.
 */
export function resolveUatRemediationRoundLimit(
  input: RoundCapDecisionInput,
): RoundCapDecision {
  const max = normalizeMax(input.maxRounds);
  const next = input.currentRound + 1;
  if (max === 'unlimited') {
    return { nextRound: next, maxRounds: 'unlimited', capReached: false };
  }
  return {
    nextRound: next,
    maxRounds: max,
    capReached: input.currentRound >= max,
  };
}

function normalizeMax(value: MaxUatRemediationRoundsConfig): number | 'unlimited' {
  if (value === false || value === null || value === undefined) return 'unlimited';
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'unlimited';
  }
  return Math.floor(value);
}
