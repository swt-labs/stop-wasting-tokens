/**
 * Compaction circuit breaker — trips after N consecutive failures, resets on
 * the first success. Prevents runaway agent loops where Codex fails to
 * compact context and SWT keeps retrying.
 */
export interface CompactionCircuitBreakerOptions {
  /** Failure count that trips the breaker. Defaults to 3. */
  readonly threshold?: number;
}

export class CompactionCircuitBreaker {
  private readonly threshold: number;
  private failureCount = 0;
  private tripped = false;

  constructor(options: CompactionCircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 3;
    if (this.threshold < 1) {
      throw new RangeError('CompactionCircuitBreaker threshold must be >= 1');
    }
  }

  recordFailure(): boolean {
    this.failureCount += 1;
    if (this.failureCount >= this.threshold) {
      this.tripped = true;
    }
    return this.tripped;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.tripped = false;
  }

  isTripped(): boolean {
    return this.tripped;
  }

  get currentFailures(): number {
    return this.failureCount;
  }

  get tripThreshold(): number {
    return this.threshold;
  }
}
