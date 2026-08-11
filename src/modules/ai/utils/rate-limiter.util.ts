/**
 * Simple token-bucket rate limiter for provider throttling.
 * Configurable via max requests per second.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly maxRps: number,
    private readonly capacity?: number,
  ) {
    const bucket = capacity ?? Math.max(1, maxRps);
    this.tokens = bucket;
    this.lastRefillMs = Date.now();
  }

  public async acquire(): Promise<void> {
    if (this.maxRps <= 0) {
      return;
    }

    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = Math.ceil(1000 / this.maxRps);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) {
      return;
    }

    const capacity = this.capacity ?? Math.max(1, this.maxRps);
    this.tokens = Math.min(
      capacity,
      this.tokens + (elapsed / 1000) * this.maxRps,
    );
    this.lastRefillMs = now;
  }
}
