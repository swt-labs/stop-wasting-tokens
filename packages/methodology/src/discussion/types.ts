export type DiscussionMode = 'bootstrap' | 'scope' | 'phase';

export type Calibration = 'builder' | 'architect';

export interface CalibrationSignals {
  readonly description?: string;
  readonly hints?: readonly string[];
  /** Explicit override (set during testing or via flag). */
  readonly forced?: Calibration;
}

export interface GrayAreaOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface GrayArea {
  readonly id: string;
  readonly topic: string;
  readonly prompt: string;
  readonly kind: 'choice' | 'text';
  readonly options?: readonly GrayAreaOption[];
  readonly defaultValue?: string;
  /** Recommendation Principle: technical decisions carry an enterprise default. */
  readonly recommendation?: string;
  readonly required?: boolean;
}

export type DiscoveryDecision = 'answered' | 'inferred' | 'deferred';

export interface DiscoveryAnswer {
  readonly id: string;
  readonly topic: string;
  readonly decision: DiscoveryDecision;
  readonly value: string;
  readonly rationale: string;
  readonly source: 'user' | 'engine' | 'recommendation';
}

export interface DiscoveryPayload {
  readonly answered: readonly DiscoveryAnswer[];
  readonly inferred: readonly DiscoveryAnswer[];
  readonly deferred: readonly DiscoveryAnswer[];
}

export interface DiscussionContext {
  readonly mode: DiscussionMode;
  readonly description?: string;
  readonly project_name?: string;
  readonly hints?: readonly string[];
}
