import { describe, expect, it } from "vitest";
import { reviewJobId, redisConnectionFromUrl } from "./queue.js";

describe("queue helpers", () => {
  it("builds a stable delivery job id", () => {
    const id = reviewJobId({
      deliveryId: "del-1",
      installationId: 1,
      owner: "o",
      repo: "r",
      prNumber: 2,
      headSha: "h",
      baseSha: "b",
    });
    expect(id).toBe("delivery:del-1");
  });

  it("parses redis URL host and port", () => {
    const conn = redisConnectionFromUrl("redis://localhost:6379");
    expect(conn.host).toBe("localhost");
    expect(conn.port).toBe(6379);
  });
});
