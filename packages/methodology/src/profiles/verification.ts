import type { VerificationTier } from '@swt-labs/core';

export interface VerificationProfile {
  readonly run_typecheck: boolean;
  readonly run_lint: boolean;
  readonly run_unit_tests: boolean;
  readonly run_integration_tests: boolean;
  readonly enforce_must_have_evidence: boolean;
  readonly enforce_traceability: boolean;
}

export const VERIFICATION_PROFILES: Readonly<
  Record<VerificationTier, VerificationProfile>
> = {
  quick: {
    run_typecheck: true,
    run_lint: true,
    run_unit_tests: false,
    run_integration_tests: false,
    enforce_must_have_evidence: false,
    enforce_traceability: false,
  },
  standard: {
    run_typecheck: true,
    run_lint: true,
    run_unit_tests: true,
    run_integration_tests: false,
    enforce_must_have_evidence: true,
    enforce_traceability: false,
  },
  deep: {
    run_typecheck: true,
    run_lint: true,
    run_unit_tests: true,
    run_integration_tests: true,
    enforce_must_have_evidence: true,
    enforce_traceability: true,
  },
};

export function resolveVerificationProfile(
  tier: VerificationTier,
): VerificationProfile {
  return VERIFICATION_PROFILES[tier];
}
