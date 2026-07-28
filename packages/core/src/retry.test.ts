import { describe, expect, it, vi } from "vitest";
import {
  computeBackoffMs,
  isRetryableHttpError,
  isRetryableHttpStatus,
  withRetry,
} from "./retry.js";

describe("isRetryableHttpStatus", () => {
  it("retries 408, 429, and 5xx", () => {
    expect(isRetryableHttpStatus(408)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
  });

  it("does not retry 4xx (except 408/429) or success", () => {
    expect(isRetryableHttpStatus(200)).toBe(false);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(422)).toBe(false);
  });
});

describe("isRetryableHttpError", () => {
  it("reads status, statusCode, and response.status", () => {
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ statusCode: 429 })).toBe(true);
    expect(isRetryableHttpError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableHttpError({ status: 404 })).toBe(false);
    expect(isRetryableHttpError(new Error("nope"))).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  it("stays within [0, capped] and respects maxDelay", () => {
    const alwaysHalf = () => 0.5;
    expect(computeBackoffMs(0, 100, 5000, alwaysHalf)).toBe(50);
    expect(computeBackoffMs(1, 100, 5000, alwaysHalf)).toBe(100);
    // 100 * 2^10 = 102400, capped to 5000 → half jitter = 2500
    expect(computeBackoffMs(10, 100, 5000, alwaysHalf)).toBe(2500);
  });
});

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const value = await withRetry(fn, { maxAttempts: 3, sleep: async () => {} });
    expect(value).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable HTTP errors then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("done");

    const sleeps: number[] = [];
    const value = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(value).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 404 });
    await expect(
      withRetry(fn, { maxAttempts: 5, sleep: async () => {} }),
    ).rejects.toEqual({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws last error after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500, message: "boom" });
    await expect(
      withRetry(fn, { maxAttempts: 3, sleep: async () => {} }),
    ).rejects.toEqual({ status: 500, message: "boom" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
