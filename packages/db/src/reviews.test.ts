import { describe, expect, it } from "vitest";
import {
  failReview,
  finishReview,
  insertFindings,
  insertReviewRunning,
  statusForOutcome,
} from "./reviews.js";

describe("review helpers", () => {
  it("exports insert and status helpers", () => {
    expect(typeof insertReviewRunning).toBe("function");
    expect(typeof finishReview).toBe("function");
    expect(typeof failReview).toBe("function");
    expect(typeof insertFindings).toBe("function");
  });

  it("maps outcomes to status", () => {
    expect(statusForOutcome("auto_post")).toBe("completed");
    expect(statusForOutcome("hitl_queue")).toBe("hitl_pending");
    expect(statusForOutcome("critical_escalate")).toBe("hitl_pending");
  });
});
