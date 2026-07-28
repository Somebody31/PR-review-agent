import { describe, expect, it, vi } from "vitest";
import type { Finding } from "@pr-review/shared";
import {
  buildReviewBody,
  collectCommentableLines,
  decideReviewEvent,
  mapFindingsToInlineComments,
  parsePatchRightLines,
  postPullRequestReview,
  type ReviewsOctokit,
} from "./post-review.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    agentType: "security",
    severity: "LOW",
    category: "style",
    summary: "Prefer const",
    filePath: "src/a.ts",
    lineStart: 10,
    confidence: 0.9,
    rationale: "mutable when unnecessary",
    ...overrides,
  };
}

/** Sample unified diff: right-side lines 10–12 are in the hunk. */
const samplePatch = [
  "@@ -10,3 +10,4 @@ function f() {",
  " context",
  "-old",
  "+new",
  "+extra",
  " more",
].join("\n");

describe("decideReviewEvent", () => {
  it("returns COMMENT when no HIGH/CRITICAL findings", () => {
    expect(decideReviewEvent([makeFinding({ severity: "MEDIUM" })])).toBe("COMMENT");
    expect(decideReviewEvent([])).toBe("COMMENT");
  });

  it("returns REQUEST_CHANGES for HIGH or CRITICAL", () => {
    expect(decideReviewEvent([makeFinding({ severity: "HIGH" })])).toBe(
      "REQUEST_CHANGES",
    );
    expect(decideReviewEvent([makeFinding({ severity: "CRITICAL" })])).toBe(
      "REQUEST_CHANGES",
    );
  });
});

describe("buildReviewBody", () => {
  it("includes summary and groups findings by severity", () => {
    const body = buildReviewBody(
      [
        makeFinding({ severity: "HIGH", summary: "Injection risk", lineStart: 3 }),
        makeFinding({
          severity: "LOW",
          agentType: "quality",
          summary: "Naming",
          filePath: "src/b.ts",
          lineStart: 1,
        }),
      ],
      "Overall look is mostly fine.",
    );

    expect(body).toContain("## AI PR Review");
    expect(body).toContain("Overall look is mostly fine.");
    expect(body).toContain("#### HIGH");
    expect(body).toContain("Injection risk");
    expect(body).toContain("#### LOW");
    expect(body).toContain("src/a.ts:3");
    expect(body).toContain("src/b.ts:1");
  });

  it("handles empty findings", () => {
    const body = buildReviewBody([], "Clean.");
    expect(body).toContain("Clean.");
    expect(body).toContain("_No findings._");
  });

  it("does not duplicate aggregate summary findings list", () => {
    const aggregateSummary = [
      "## AI PR review",
      "",
      "**Outcome:** `auto_post`",
      "**Findings:** 1",
      "",
      "- **[HIGH]** `src/a.ts:10` — Prefer const _(confidence 0.90, security)_",
    ].join("\n");

    const body = buildReviewBody(
      [makeFinding({ severity: "HIGH", summary: "Prefer const", lineStart: 10 })],
      aggregateSummary,
    );

    expect(body).toContain("## AI PR Review");
    expect(body).toContain("**Outcome:** `auto_post`");
    expect(body).toContain("**Findings:** 1");
    // One findings section only — not aggregate bullets + severity list
    expect(body).not.toMatch(/## AI PR review/);
    expect(body).not.toContain("_(confidence 0.90, security)_");
    expect(body).toContain("#### HIGH");
    expect((body.match(/Prefer const/g) ?? []).length).toBe(1);
  });
});

describe("parsePatchRightLines", () => {
  it("includes context and added lines, skips removed", () => {
    const lines = parsePatchRightLines(samplePatch);
    // right starts at 10: space, +, +, space → 10,11,12,13
    expect(lines.has(10)).toBe(true);
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(13)).toBe(true);
    expect(lines.has(9)).toBe(false);
    expect(lines.has(14)).toBe(false);
  });

  it("returns empty set for deletion-only hunks", () => {
    const patch = ["@@ -5,2 +5,0 @@", "-gone", "-also"].join("\n");
    const lines = parsePatchRightLines(patch);
    expect(lines.size).toBe(0);
  });
});

describe("collectCommentableLines", () => {
  it("indexes by path and skips files without patch", () => {
    const map = collectCommentableLines([
      { path: "src/a.ts", patch: samplePatch },
      { path: "src/b.ts" },
    ]);
    expect(map.has("src/a.ts")).toBe(true);
    expect(map.has("src/b.ts")).toBe(false);
    expect(map.get("src/a.ts")?.has(11)).toBe(true);
  });
});

describe("mapFindingsToInlineComments", () => {
  it("maps file path, line, and body when line is in the diff", () => {
    const commentable = collectCommentableLines([
      { path: "src/a.ts", patch: samplePatch },
    ]);
    const comments = mapFindingsToInlineComments(
      [
        makeFinding({
          severity: "MEDIUM",
          summary: "Missing null check",
          rationale: "value can be null",
          suggestion: "Add a guard",
          lineStart: 11,
        }),
      ],
      commentable,
    );

    expect(comments).toHaveLength(1);
    expect(comments[0]?.path).toBe("src/a.ts");
    expect(comments[0]?.line).toBe(11);
    expect(comments[0]?.body).toContain("**MEDIUM**");
    expect(comments[0]?.body).toContain("Missing null check");
    expect(comments[0]?.body).toContain("value can be null");
    expect(comments[0]?.body).toContain("Suggestion: Add a guard");
  });

  it("skips findings whose line is not in the PR diff", () => {
    const commentable = collectCommentableLines([
      { path: "src/a.ts", patch: samplePatch },
    ]);
    const comments = mapFindingsToInlineComments(
      [
        makeFinding({ filePath: "src/a.ts", lineStart: 99 }),
        makeFinding({ filePath: "other.ts", lineStart: 11 }),
      ],
      commentable,
    );
    expect(comments).toHaveLength(0);
  });
});

describe("postPullRequestReview", () => {
  it("calls createReview with mapped body, event, and only in-diff comments", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 99_001 } });
    const octokit: ReviewsOctokit = {
      rest: {
        pulls: {
          createReview,
        },
      },
    };

    const findings = [
      makeFinding({ severity: "HIGH", summary: "SQL concat", lineStart: 11 }),
      makeFinding({ severity: "LOW", summary: "Not in diff", lineStart: 999 }),
    ];

    const result = await postPullRequestReview(octokit, {
      owner: "acme",
      repo: "api",
      prNumber: 12,
      headSha: "abc123",
      findings,
      summaryMarkdown: "Needs changes.",
      files: [{ path: "src/a.ts", patch: samplePatch }],
    });

    expect(result.githubReviewId).toBe("99001");
    expect(createReview).toHaveBeenCalledTimes(1);
    const args = createReview.mock.calls[0]?.[0] as {
      owner: string;
      repo: string;
      pull_number: number;
      commit_id: string;
      event: string;
      body: string;
      comments: Array<{ path: string; line: number; body: string }>;
    };
    expect(args.owner).toBe("acme");
    expect(args.repo).toBe("api");
    expect(args.pull_number).toBe(12);
    expect(args.commit_id).toBe("abc123");
    expect(args.event).toBe("REQUEST_CHANGES");
    expect(args.body).toContain("SQL concat");
    expect(args.body).toContain("Not in diff");
    expect(args.comments).toHaveLength(1);
    expect(args.comments[0]?.line).toBe(11);
  });

  it("omits comments array when there are no in-diff findings", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const octokit: ReviewsOctokit = {
      rest: { pulls: { createReview } },
    };

    await postPullRequestReview(octokit, {
      owner: "acme",
      repo: "api",
      prNumber: 1,
      headSha: "sha",
      findings: [],
      summaryMarkdown: "LGTM",
      files: [],
    });

    const args = createReview.mock.calls[0]?.[0] as { comments?: unknown; event: string };
    expect(args.event).toBe("COMMENT");
    expect(args.comments).toBeUndefined();
  });

  it("falls back to body-only when createReview with comments fails validation (422)", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Validation Failed"), { status: 422 }))
      .mockResolvedValueOnce({ data: { id: 77 } });

    const octokit: ReviewsOctokit = {
      rest: { pulls: { createReview } },
    };

    const result = await postPullRequestReview(octokit, {
      owner: "acme",
      repo: "api",
      prNumber: 2,
      headSha: "sha2",
      findings: [makeFinding({ lineStart: 11, summary: "Still in body" })],
      summaryMarkdown: "Fallback path",
      files: [{ path: "src/a.ts", patch: samplePatch }],
    });

    expect(result.githubReviewId).toBe("77");
    expect(createReview).toHaveBeenCalledTimes(2);

    const first = createReview.mock.calls[0]?.[0] as { comments?: unknown };
    const second = createReview.mock.calls[1]?.[0] as {
      comments?: unknown;
      body: string;
    };
    expect(first.comments).toBeDefined();
    expect(second.comments).toBeUndefined();
    expect(second.body).toContain("Still in body");
  });

  it("rethrows retryable 5xx so callers (withRetry) can retry the full post", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Internal Server Error"), { status: 500 }));

    const octokit: ReviewsOctokit = {
      rest: { pulls: { createReview } },
    };

    await expect(
      postPullRequestReview(octokit, {
        owner: "acme",
        repo: "api",
        prNumber: 2,
        headSha: "sha2",
        findings: [makeFinding({ lineStart: 11, summary: "Do not body-only" })],
        summaryMarkdown: "Retry path",
        files: [{ path: "src/a.ts", patch: samplePatch }],
      }),
    ).rejects.toMatchObject({ status: 500 });

    // Must not fall back to a second body-only createReview on 5xx
    expect(createReview).toHaveBeenCalledTimes(1);
    const args = createReview.mock.calls[0]?.[0] as { comments?: unknown };
    expect(args.comments).toBeDefined();
  });
});
