/**
 * Verification tier — selects which checks the QA agent runs.
 *
 *  - `quick`:    smoke + lint + types
 *  - `standard`: quick + unit tests + plan must-have evidence
 *  - `deep`:     standard + integration tests + cross-phase traceability
 */
export type VerificationTier = 'quick' | 'standard' | 'deep';

export const VERIFICATION_TIERS: readonly VerificationTier[] = [
  'quick',
  'standard',
  'deep',
] as const;

export function isVerificationTier(value: unknown): value is VerificationTier {
  return typeof value === 'string' && (VERIFICATION_TIERS as readonly string[]).includes(value);
}
