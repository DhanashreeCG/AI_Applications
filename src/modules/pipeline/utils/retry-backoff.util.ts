export function calculateRetryDelaySeconds(
  attempt: number,
  baseSeconds: number,
  maxSeconds: number,
): number {
  const exponential = baseSeconds * Math.pow(2, Math.max(attempt - 1, 0));
  const jitter = Math.floor(Math.random() * baseSeconds);
  return Math.min(exponential + jitter, maxSeconds);
}
