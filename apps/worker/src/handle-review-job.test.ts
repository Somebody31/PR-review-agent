import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewJob } from "@pr-review/shared";
import { handleReviewJob } from "./handle-review-job.js";

const insertReviewRunning = vi.fn();
const insertFindings = vi.fn();
const finishReview = vi.fn();
const failReview = vi.fn();
const findPostedReviewByHead = vi.fn();
const setGithubReviewId = vi.fn();
const getDb = vi.fn();
const runReviewGraph = vi.fn();
const createGithubApp = vi.fn();
const getInstallationOctokit = vi.fn();
const fetchPrContext = vi.fn();
const postPullRequestReview = vi.fn();
const loadConfig = vi.fn();
const indexChangedFiles = vi.fn();
const retrieveContext = vi.fn();
const buildRetrievalQuery = vi.fn();
const formatRetrievedContext = vi.fn();

vi.mock("@pr-review/db", () => ({
  insertReviewRunning: (...args: unknown[]) => insertReviewRunning(...args),
  insertFindings: (...args: unknown[]) => insertFindings(...args),
  finishReview: (...args: unknown[]) => finishReview(...args),
  failReview: (...args: unknown[]) => failReview(...args),
  findPostedReviewByHead: (...args: unknown[]) => findPostedReviewByHead(...args),
  setGithubReviewId: (...args: unknown[]) => setGithubReviewId(...args),
  getDb: (...args: unknown[]) => getDb(...args),
  statusForOutcome: (outcome: string) =>
    outcome === "hitl_queue" || outcome === "critical_escalate"
      ? "hitl_pending"
      : "completed",
}));

vi.mock("@pr-review/agents", () => ({
  runReviewGraph: (...args: unknown[]) => runReviewGraph(...args),
}));

vi.mock("@pr-review/github", () => ({
  createGithubApp: (...args: unknown[]) => createGithubApp(...args),
  getInstallationOctokit: (...args: unknown[]) => getInstallationOctokit(...args),
  fetchPrContext: (...args: unknown[]) => fetchPrContext(...args),
  postPullRequestReview: (...args: unknown[]) => postPullRequestReview(...args),
}));

vi.mock("@pr-review/memory", () => ({
  indexChangedFiles: (...args: unknown[]) => indexChangedFiles(...args),
  retrieveContext: (...args: unknown[]) => retrieveContext(...args),
  buildRetrievalQuery: (...args: unknown[]) => buildRetrievalQuery(...args),
  formatRetrievedContext: (...args: unknown[]) => formatRetrievedContext(...args),
}));

vi.mock("@pr-review/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pr-review/core")>();
  return {
    ...actual,
    loadConfig: (...args: unknown[]) => loadConfig(...args),
    createLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const job: ReviewJob = {
  deliveryId: "d1",
  installationId: 9,
  owner: "acme",
  repo: "api",
  prNumber: 3,
  headSha: "h",
  baseSha: "b",
};

const sampleFinding = {
  agentType: "security" as const,
  severity: "LOW" as const,
  category: "x",
  summary: "s",
  filePath: "a.ts",
  lineStart: 1,
  confidence: 0.8,
  rationale: "r",
};

describe("handleReviewJob", () => {
  beforeEach(() => {
    insertReviewRunning.mockReset();
    insertFindings.mockReset();
    finishReview.mockReset();
    failReview.mockReset();
    findPostedReviewByHead.mockReset();
    setGithubReviewId.mockReset();
    getDb.mockReset();
    runReviewGraph.mockReset();
    createGithubApp.mockReset();
    getInstallationOctokit.mockReset();
    fetchPrContext.mockReset();
    postPullRequestReview.mockReset();
    loadConfig.mockReset();
    indexChangedFiles.mockReset();
    retrieveContext.mockReset();
    buildRetrievalQuery.mockReset();
    formatRetrievedContext.mockReset();

    getDb.mockReturnValue({});
    insertReviewRunning.mockResolvedValue("review-1");
    findPostedReviewByHead.mockResolvedValue(null);
    setGithubReviewId.mockResolvedValue(undefined);
    loadConfig.mockReturnValue({
      DATABASE_URL: "postgresql://local/test",
      REDIS_URL: "redis://localhost:6379",
      DEEPSEEK_API_KEY: "key",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      LLM_MODEL: "deepseek-v4-flash",
      GITHUB_APP_ID: "1",
      GITHUB_PRIVATE_KEY: "k",
      AUTO_POST_ENABLED: false,
      HITL_CONFIDENCE_THRESHOLD: 0.75,
      EMBEDDING_BASE_URL: "http://127.0.0.1:8000/v1",
      EMBEDDING_API_KEY: "local",
      EMBEDDING_MODEL: "Qwen/Qwen3-Embedding-0.6B",
    });
    createGithubApp.mockReturnValue({});
    getInstallationOctokit.mockResolvedValue({
      rest: { pulls: { createReview: vi.fn() } },
    });
    fetchPrContext.mockResolvedValue({
      owner: "acme",
      repo: "api",
      prNumber: 3,
      title: "t",
      body: "",
      headSha: "h",
      baseSha: "b",
      files: [
        {
          path: "a.ts",
          status: "modified",
          content: "x",
          patch: "@@ -1 +1 @@\n+x",
        },
      ],
    });
    indexChangedFiles.mockResolvedValue({ reembeddedFiles: 1, skippedUnchanged: 0 });
    buildRetrievalQuery.mockReturnValue("query");
    retrieveContext.mockResolvedValue([{ path: "a.ts", content: "x", score: 0.9 }]);
    formatRetrievedContext.mockReturnValue("### a.ts\n```\nx\n```");
    runReviewGraph.mockResolvedValue({
      result: {
        reviewId: "review-1",
        prNumber: 3,
        repo: "acme/api",
        findings: [sampleFinding],
        overallConfidence: 0.8,
        outcome: "hitl_queue",
        summaryMarkdown: "summary",
      },
      agentTimings: ["security:1ms", "quality:1ms", "tests:1ms", "docs:1ms"],
    });
  });

  it("indexes RAG context and passes repoContext into the graph", async () => {
    await handleReviewJob(job);

    expect(indexChangedFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        repoKey: "acme/api",
      }),
    );
    expect(retrieveContext).toHaveBeenCalled();
    expect(runReviewGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        repoContext: "### a.ts\n```\nx\n```",
      }),
    );
    expect(insertFindings).toHaveBeenCalled();
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        status: "hitl_pending",
        outcome: "hitl_queue",
      }),
    );
  });

  it("soft-fails RAG and still completes a diff-only review", async () => {
    indexChangedFiles.mockRejectedValue(new Error("embed server down"));

    await handleReviewJob(job);

    expect(runReviewGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        repoContext: "",
      }),
    );
    expect(insertFindings).toHaveBeenCalled();
    expect(failReview).not.toHaveBeenCalled();
  });

  it("does not post to GitHub when outcome is not auto_post", async () => {
    await handleReviewJob(job);

    expect(postPullRequestReview).not.toHaveBeenCalled();
    expect(findPostedReviewByHead).not.toHaveBeenCalled();
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        outcome: "hitl_queue",
        githubReviewId: undefined,
      }),
    );
  });

  it("posts to GitHub when outcome is auto_post and stores github_review_id", async () => {
    runReviewGraph.mockResolvedValue({
      result: {
        reviewId: "review-1",
        prNumber: 3,
        repo: "acme/api",
        findings: [sampleFinding],
        overallConfidence: 0.95,
        outcome: "auto_post",
        summaryMarkdown: "Looks good.",
      },
      agentTimings: ["security:1ms"],
    });
    postPullRequestReview.mockResolvedValue({ githubReviewId: "gh-42" });

    await handleReviewJob(job);

    expect(findPostedReviewByHead).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        prNumber: 3,
        headSha: "h",
      }),
    );
    expect(postPullRequestReview).toHaveBeenCalledTimes(1);
    expect(postPullRequestReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        prNumber: 3,
        headSha: "h",
        summaryMarkdown: "Looks good.",
        files: expect.arrayContaining([
          expect.objectContaining({ path: "a.ts", patch: "@@ -1 +1 @@\n+x" }),
        ]),
      }),
    );
    // Id is written immediately after post, before finishReview
    expect(setGithubReviewId).toHaveBeenCalledWith({}, "review-1", "gh-42");
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        status: "completed",
        outcome: "auto_post",
        githubReviewId: "gh-42",
      }),
    );
    const setOrder = setGithubReviewId.mock.invocationCallOrder[0] ?? 0;
    const finishOrder = finishReview.mock.invocationCallOrder[0] ?? 0;
    expect(setOrder).toBeLessThan(finishOrder);
  });

  it("skips GitHub post when this head already has a stored review id", async () => {
    runReviewGraph.mockResolvedValue({
      result: {
        reviewId: "review-1",
        prNumber: 3,
        repo: "acme/api",
        findings: [sampleFinding],
        overallConfidence: 0.95,
        outcome: "auto_post",
        summaryMarkdown: "Looks good.",
      },
      agentTimings: [],
    });
    findPostedReviewByHead.mockResolvedValue({
      id: "older-review",
      githubReviewId: "gh-existing",
    });

    await handleReviewJob(job);

    expect(postPullRequestReview).not.toHaveBeenCalled();
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        outcome: "auto_post",
        githubReviewId: "gh-existing",
      }),
    );
  });

  it("retries GitHub post on 500 then succeeds via withRetry", async () => {
    runReviewGraph.mockResolvedValue({
      result: {
        reviewId: "review-1",
        prNumber: 3,
        repo: "acme/api",
        findings: [sampleFinding],
        overallConfidence: 0.95,
        outcome: "auto_post",
        summaryMarkdown: "Looks good.",
      },
      agentTimings: ["security:1ms"],
    });
    postPullRequestReview
      .mockRejectedValueOnce(
        Object.assign(new Error("Internal Server Error"), { status: 500 }),
      )
      .mockResolvedValueOnce({ githubReviewId: "gh-after-retry" });

    await handleReviewJob(job);

    expect(postPullRequestReview).toHaveBeenCalledTimes(2);
    expect(setGithubReviewId).toHaveBeenCalledWith({}, "review-1", "gh-after-retry");
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        status: "completed",
        outcome: "auto_post",
        githubReviewId: "gh-after-retry",
      }),
    );
  });
});
