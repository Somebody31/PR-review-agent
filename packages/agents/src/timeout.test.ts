import { describe, expect, it } from "vitest";
import { withTimeout } from "./timeout.js";

describe("withTimeout", () => {
  it("resolves when work finishes in time", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "fast");
    expect(value).toBe(42);
  });

  it("rejects when work is too slow", async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 200);
    });
    await expect(withTimeout(slow, 20, "slow")).rejects.toThrow(/timed out/);
  });
});
