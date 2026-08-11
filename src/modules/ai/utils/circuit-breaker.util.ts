export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(provider: string, cooldownMs: number) {
    super(
      `Circuit open for ${provider}; retry after ${cooldownMs}ms (429/transient)`,
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * In-memory circuit breaker: closed → open after N consecutive failures →
 * half-open after cooldown → closed on success.
 */
export class CircuitBreaker {
  private failureCount = 0;
  private state: CircuitState = 'closed';
  private openedAtMs = 0;

  constructor(
    private readonly providerName: string,
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  public getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  public beforeRequest(): void {
    this.maybeTransitionToHalfOpen();
    if (this.state === 'open') {
      const remaining = Math.max(
        0,
        this.cooldownMs - (Date.now() - this.openedAtMs),
      );
      throw new CircuitOpenError(this.providerName, remaining);
    }
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  public recordFailure(): void {
    this.failureCount += 1;
    if (
      this.state === 'half-open' ||
      this.failureCount >= this.failureThreshold
    ) {
      this.state = 'open';
      this.openedAtMs = Date.now();
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'open' &&
      Date.now() - this.openedAtMs >= this.cooldownMs
    ) {
      this.state = 'half-open';
    }
  }
}
