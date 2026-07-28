import { describe, expect, it } from "vitest";
import { handleReviewJob } from "./handle-review-job.js";

describe("handleReviewJob", () => {
  it("resolves for a minimal job payload", async () => {
    await expect(
      handleReviewJob({
        deliveryId: "d1",
        installationId: 1,
        owner: "o",
        repo: "r",
        prNumber: 1,
        headSha: "h",
        baseSha: "b",
      }),
    ).resolves.toBeUndefined();
  });
});
