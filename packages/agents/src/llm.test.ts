import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { completeStructured, estimateCostUsd } from "./llm.js";

const findingsSchema = z.array(
  z.object({
    summary: z.string(),
  }),
);

describe("estimateCostUsd", () => {
  it("returns a positive cost for non-zero usage", () => {
    const cost = estimateCostUsd("deepseek-v4-flash", {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

describe("completeStructured", () => {
  it("parses valid JSON findings from a mocked fetch", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify([{ summary: "ok" }]) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await completeStructured({
      apiKey: "test",
      baseUrl: "https://example.test/v1",
      model: "deepseek-v4-flash",
      system: "sys",
      user: "user",
      schema: findingsSchema,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.data).toEqual([{ summary: "ok" }]);
    expect(result.usage.tokensIn).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once when first response is invalid JSON", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "not-json" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([{ summary: "fixed" }]),
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    });

    const result = await completeStructured({
      apiKey: "test",
      baseUrl: "https://example.test/v1",
      model: "m",
      system: "s",
      user: "u",
      schema: findingsSchema,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.data[0]?.summary).toBe("fixed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when repair still returns invalid JSON", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "still-not-json" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    });

    await expect(
      completeStructured({
        apiKey: "test",
        baseUrl: "https://example.test/v1",
        model: "m",
        system: "s",
        user: "u",
        schema: findingsSchema,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/failed after retry/);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
