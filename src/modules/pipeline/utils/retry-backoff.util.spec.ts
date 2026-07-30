import { calculateRetryDelaySeconds } from './retry-backoff.util';

describe('calculateRetryDelaySeconds', () => {
  it('should increase delay exponentially and cap at max seconds', () => {
    const first = calculateRetryDelaySeconds(1, 30, 900);
    const second = calculateRetryDelaySeconds(2, 30, 900);
    const capped = calculateRetryDelaySeconds(10, 30, 120);

    expect(first).toBeGreaterThanOrEqual(30);
    expect(second).toBeGreaterThan(first - 30);
    expect(capped).toBeLessThanOrEqual(120);
  });
});
