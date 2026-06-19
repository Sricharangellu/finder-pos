export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  retryableErrors?: (err: unknown) => boolean;
}

export const DefaultRetryPolicy: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 10_000,
};

export const NoRetryPolicy: RetryOptions = {
  maxAttempts: 1,
  initialDelayMs: 0,
  backoffFactor: 1,
  maxDelayMs: 0,
};

export const FinancialRetryPolicy: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  backoffFactor: 2,
  maxDelayMs: 8_000,
  // Only retry transient DB/network errors — never retry idempotency conflicts or 4xx.
  retryableErrors: (err) => {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes("connection") ||
      msg.includes("timeout") ||
      msg.includes("deadlock") ||
      msg.includes("serialization")
    );
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute fn with retries according to policy.
 * Throws the last error if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryOptions = DefaultRetryPolicy,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === policy.maxAttempts) break;
      if (policy.retryableErrors && !policy.retryableErrors(err)) break;
      const wait = Math.min(
        policy.initialDelayMs * Math.pow(policy.backoffFactor, attempt - 1),
        policy.maxDelayMs,
      );
      if (wait > 0) await delay(wait);
    }
  }
  throw lastErr;
}
