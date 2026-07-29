import { describe, expect, it, vi } from "vitest";
import {
  getFindingById,
  getHitlItemById,
  insertHitlFeedback,
  insertHitlItem,
  listFindingsForReview,
  updateHitlState,
} from "./hitl.js";
import type { Database } from "./client.js";

describe("insertHitlItem", () => {
  it("returns the new hitl id", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "hitl-1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    const id = await insertHitlItem(db, "review-1");

    expect(id).toBe("hitl-1");
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: "review-1", state: "pending" }),
    );
  });

  it("throws when insert returns no id", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    await expect(insertHitlItem(db, "review-1")).rejects.toThrow(/failed to insert hitl/);
  });
});

describe("getHitlItemById", () => {
  it("returns null when missing", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    expect(await getHitlItemById(db, "missing")).toBeNull();
  });

  it("returns joined hitl + review fields", async () => {
    const sample = {
      id: "h1",
      reviewId: "r1",
      state: "pending",
      assignee: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      owner: "acme",
      repo: "api",
      prNumber: 3,
      headSha: "abc",
      installationId: 9,
      summaryMarkdown: "summary",
      status: "hitl_pending",
      githubReviewId: null,
    };
    const limit = vi.fn().mockResolvedValue([sample]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const row = await getHitlItemById(db, "h1");
    expect(row).toEqual(sample);
  });
});

describe("updateHitlState", () => {
  it("sets state only from pending and returns true when claimed", async () => {
    let setValues: Record<string, unknown> | undefined;
    const returning = vi.fn().mockResolvedValue([{ id: "h1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockImplementation((values: Record<string, unknown>) => {
      setValues = values;
      return { where };
    });
    const update = vi.fn().mockReturnValue({ set });
    const db = { update } as unknown as Database;

    const claimed = await updateHitlState(db, "h1", "approved");

    expect(claimed).toBe(true);
    expect(setValues?.state).toBe("approved");
    expect(setValues?.updatedAt).toBeInstanceOf(Date);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("returns false when no pending row was updated", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = { update } as unknown as Database;

    const claimed = await updateHitlState(db, "h1", "approved");
    expect(claimed).toBe(false);
  });
});

describe("getFindingById", () => {
  it("returns null when missing", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    expect(await getFindingById(db, "missing")).toBeNull();
  });

  it("returns the finding row", async () => {
    const sample = {
      id: "f1",
      reviewId: "r1",
      agentType: "security",
      severity: "HIGH",
      category: "injection",
      summary: "sql",
      filePath: "a.ts",
      lineStart: 2,
      lineEnd: null,
      suggestion: null,
      confidence: 0.9,
      rationale: "concat",
    };
    const limit = vi.fn().mockResolvedValue([sample]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    expect(await getFindingById(db, "f1")).toEqual(sample);
  });
});

describe("listFindingsForReview", () => {
  it("returns finding rows for the review", async () => {
    const sample = [
      {
        id: "f1",
        reviewId: "r1",
        agentType: "security",
        severity: "LOW",
        category: "x",
        summary: "s",
        filePath: "a.ts",
        lineStart: 1,
        lineEnd: null,
        suggestion: null,
        confidence: 0.8,
        rationale: "r",
      },
    ];
    const where = vi.fn().mockResolvedValue(sample);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const rows = await listFindingsForReview(db, "r1");
    expect(rows).toEqual(sample);
  });
});

describe("insertHitlFeedback", () => {
  it("stores dispute action and returns id", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "fb-1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    const id = await insertHitlFeedback(db, {
      reviewId: "r1",
      findingId: "f1",
      action: "dispute",
      comment: "false positive",
    });

    expect(id).toBe("fb-1");
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "r1",
        findingId: "f1",
        action: "dispute",
        comment: "false positive",
      }),
    );
  });
});
