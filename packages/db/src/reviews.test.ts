import { describe, expect, it, vi } from "vitest";
import {
  failReview,
  findPostedReviewByHead,
  finishReview,
  insertFindings,
  insertReviewRunning,
  setGithubReviewId,
  statusForOutcome,
} from "./reviews.js";
import type { Database } from "./client.js";

describe("review helpers", () => {
  it("exports insert and status helpers", () => {
    expect(typeof insertReviewRunning).toBe("function");
    expect(typeof finishReview).toBe("function");
    expect(typeof failReview).toBe("function");
    expect(typeof insertFindings).toBe("function");
    expect(typeof findPostedReviewByHead).toBe("function");
    expect(typeof setGithubReviewId).toBe("function");
  });

  it("maps outcomes to status", () => {
    expect(statusForOutcome("auto_post")).toBe("completed");
    expect(statusForOutcome("hitl_queue")).toBe("hitl_pending");
    expect(statusForOutcome("critical_escalate")).toBe("hitl_pending");
    // Human reject is terminal completed (not left in the HITL queue)
    expect(statusForOutcome("hitl_rejected")).toBe("completed");
  });
});

/**
 * Minimal chain that mirrors drizzle select().from().where().limit().
 * findPostedReviewByHead only needs the final limit() rows.
 */
function makeSelectDb(rows: Array<{ id: string; githubReviewId: string | null }>): Database {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as unknown as Database;
}

/**
 * Minimal chain for update().set().where().
 */
function makeUpdateDb(onSet?: (values: Record<string, unknown>) => void): {
  db: Database;
  where: ReturnType<typeof vi.fn>;
} {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockImplementation((values: Record<string, unknown>) => {
    if (onSet) {
      onSet(values);
    }
    return { where };
  });
  const update = vi.fn().mockReturnValue({ set });
  return { db: { update } as unknown as Database, where };
}

describe("findPostedReviewByHead", () => {
  it("returns id and githubReviewId when a posted row exists", async () => {
    const db = makeSelectDb([
      { id: "rev-1", githubReviewId: "gh-100" },
    ]);

    const found = await findPostedReviewByHead(db, {
      owner: "acme",
      repo: "api",
      prNumber: 3,
      headSha: "abc",
    });

    expect(found).toEqual({
      id: "rev-1",
      githubReviewId: "gh-100",
    });
  });

  it("returns null when no row matches", async () => {
    const db = makeSelectDb([]);

    const found = await findPostedReviewByHead(db, {
      owner: "acme",
      repo: "api",
      prNumber: 3,
      headSha: "abc",
    });

    expect(found).toBeNull();
  });

  it("returns null when githubReviewId is missing on the row", async () => {
    const db = makeSelectDb([{ id: "rev-2", githubReviewId: null }]);

    const found = await findPostedReviewByHead(db, {
      owner: "acme",
      repo: "api",
      prNumber: 3,
      headSha: "abc",
    });

    expect(found).toBeNull();
  });
});

describe("setGithubReviewId", () => {
  it("updates only githubReviewId (and updatedAt) on the review row", async () => {
    let setValues: Record<string, unknown> | undefined;
    const { db, where } = makeUpdateDb((values) => {
      setValues = values;
    });

    await setGithubReviewId(db, "review-99", "gh-posted");

    expect(setValues?.githubReviewId).toBe("gh-posted");
    expect(setValues?.updatedAt).toBeInstanceOf(Date);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
