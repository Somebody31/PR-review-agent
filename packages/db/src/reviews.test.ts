import { describe, expect, it } from "vitest";
import {
  completeContextShell,
  failReview,
  insertReviewRunning,
} from "./reviews.js";

describe("review shell helpers", () => {
  it("exports insert and status update functions", () => {
    expect(typeof insertReviewRunning).toBe("function");
    expect(typeof completeContextShell).toBe("function");
    expect(typeof failReview).toBe("function");
  });
});
