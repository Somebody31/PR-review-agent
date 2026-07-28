/**
 * Options for withRetry. Defaults are intentionally small for unit tests and API posts.
 */
export type WithRetryOptions = {
  /** Total attempts including the first try. Default 3. */
  maxAttempts?: number;
  /** Base delay before first retry; doubles each attempt. Default 100ms. */
  baseDelayMs?: number;
  /** Cap on delay between attempts. Default 5000ms. */
  maxDelayMs?: number;
  /** Return true to retry this error. Default: isRetryableHttpError. */
  isRetryable?: (error: unknown) => boolean;
  /** Injectable sleep for tests (defaults to setTimeout). */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * True for HTTP statuses that are usually safe to retry (timeouts, rate limits, 5xx).
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 408 || status === 429) {
    return true;
  }
  if (status >= 500 && status <= 599) {
    return true;
  }
  return false;
}

/**
 * Inspect common error shapes (Octokit / fetch / plain status) for retryable HTTP codes.
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error === "object") {
    const record = error as {
      status?: unknown;
      response?: { status?: unknown };
      statusCode?: unknown;
    };

    if (typeof record.status === "number" && isRetryableHttpStatus(record.status)) {
      return true;
    }
    if (
      typeof record.statusCode === "number" &&
      isRetryableHttpStatus(record.statusCode)
    ) {
      return true;
    }
    const responseStatus = record.response?.status;
    if (typeof responseStatus === "number" && isRetryableHttpStatus(responseStatus)) {
      return true;
    }
  }

  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Exponential delay with full jitter so concurrent retries do not stampede.
 * attemptIndex is 0 for the first retry after the initial failure.
 */
export function computeBackoffMs(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exp = baseDelayMs * Math.pow(2, attemptIndex);
  const capped = Math.min(exp, maxDelayMs);
  // Full jitter: sleep in [0, capped]
  return Math.floor(random() * capped);
}

/**
 * Run `fn` until it succeeds or attempts are exhausted.
 * Only retries when isRetryable(error) is true (default: retryable HTTP).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const isRetryable = options.isRetryable ?? isRetryableHttpError;
  const sleep = options.sleep ?? defaultSleep;

  if (maxAttempts < 1) {
    throw new Error("withRetry maxAttempts must be >= 1");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      return result;
    } catch (error: unknown) {
      lastError = error;
      const hasMoreAttempts = attempt < maxAttempts;
      if (!hasMoreAttempts || !isRetryable(error)) {
        throw error;
      }
      const delayMs = computeBackoffMs(attempt - 1, baseDelayMs, maxDelayMs);
      await sleep(delayMs);
    }
  }

  // Unreachable when maxAttempts >= 1, but keeps TypeScript happy
  throw lastError;
}
