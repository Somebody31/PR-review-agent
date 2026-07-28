import { describe, expect, it, vi } from "vitest";
import { embedTexts } from "./embed.js";

describe("embedTexts", () => {
  it("returns vectors from a mocked embeddings API", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
        }),
        { status: 200 },
      );
    });

    const vectors = await embedTexts({
      embed: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "local",
        model: "Qwen/Qwen3-Embedding-0.6B",
      },
      inputs: ["a", "b"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([0.1, 0.2, 0.3]);
  });
});
