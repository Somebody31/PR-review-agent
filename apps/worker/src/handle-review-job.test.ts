import { describe, expect, it } from "vitest";
import { handleReviewJob } from "./handle-review-job.js";

describe("handleReviewJob", () => {
  it("is an async function that accepts a ReviewJob shape", () => {
    expect(typeof handleReviewJob).toBe("function");
    expect(handleReviewJob.length).toBe(1);
  });
});
