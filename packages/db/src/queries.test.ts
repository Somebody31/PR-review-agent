import { describe, expect, it, vi } from "vitest";
import { getReviewById, listHitlItems, listReviews, reviewExists } from "./queries.js";
import type { Database } from "./client.js";

describe("listReviews", () => {
  it("returns rows from select chain", async () => {
    const sample = [
      {
        id: "r1",
        owner: "acme",
        repo: "api",
        prNumber: 1,
        headSha: "abc",
        status: "completed",
        overallConfidence: 0.9,
        outcome: "auto_post",
        costUsd: "0.01",
        githubReviewId: "gh-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const limit = vi.fn().mockResolvedValue(sample);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ orderBy });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const rows = await listReviews(db, 10);

    expect(rows).toEqual(sample);
    expect(limit).toHaveBeenCalledWith(10);
  });
});

describe("reviewExists", () => {
  it("returns false when no row", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    expect(await reviewExists(db, "missing")).toBe(false);
  });

  it("returns true when id is present", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    expect(await reviewExists(db, "r1")).toBe(true);
  });
});

describe("getReviewById", () => {
  it("returns null when review is missing", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const detail = await getReviewById(db, "missing");
    expect(detail).toBeNull();
  });

  it("returns review with findings", async () => {
    let call = 0;
    const select = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: "r1",
                  owner: "acme",
                  repo: "api",
                  prNumber: 1,
                  headSha: "h",
                  baseSha: "b",
                  status: "completed",
                  overallConfidence: 0.8,
                  outcome: "hitl_queue",
                  summaryMarkdown: "s",
                  costUsd: null,
                  errorMessage: null,
                  githubReviewId: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: "f1",
              agentType: "security",
              severity: "LOW",
              category: "x",
              summary: "note",
              filePath: "a.ts",
              lineStart: 1,
              lineEnd: null,
              suggestion: null,
              confidence: 0.8,
              rationale: "r",
            },
          ]),
        }),
      };
    });

    const db = { select } as unknown as Database;
    const detail = await getReviewById(db, "r1");

    expect(detail?.id).toBe("r1");
    expect(detail?.findings).toHaveLength(1);
    expect(detail?.findings[0]?.summary).toBe("note");
  });
});

describe("listHitlItems", () => {
  it("returns joined hitl rows", async () => {
    const sample = [
      {
        id: "h1",
        reviewId: "r1",
        state: "pending",
        assignee: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        owner: "acme",
        repo: "api",
        prNumber: 3,
      },
    ];
    const limit = vi.fn().mockResolvedValue(sample);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const leftJoin = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ leftJoin });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const rows = await listHitlItems(db);

    expect(rows).toEqual(sample);
  });
});
