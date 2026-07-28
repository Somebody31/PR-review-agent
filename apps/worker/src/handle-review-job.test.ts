import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewJob } from "@pr-review/shared";
import { handleReviewJob } from "./handle-review-job.js";

const insertReviewRunning = vi.fn();
const insertFindings = vi.fn();
const finishReview = vi.fn();
const failReview = vi.fn();
const getDb = vi.fn();
const runReviewGraph = vi.fn();
const createGithubApp = vi.fn();
const getInstallationOctokit = vi.fn();
const fetchPrContext = vi.fn();
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

describe("handleReviewJob", () => {
  beforeEach(() => {
    insertReviewRunning.mockReset();
    insertFindings.mockReset();
    finishReview.mockReset();
    failReview.mockReset();
    getDb.mockReset();
    runReviewGraph.mockReset();
    createGithubApp.mockReset();
    getInstallationOctokit.mockReset();
    fetchPrContext.mockReset();
    loadConfig.mockReset();
    indexChangedFiles.mockReset();
    retrieveContext.mockReset();
    buildRetrievalQuery.mockReset();
    formatRetrievedContext.mockReset();

    getDb.mockReturnValue({});
    insertReviewRunning.mockResolvedValue("review-1");
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
    getInstallationOctokit.mockResolvedValue({});
    fetchPrContext.mockResolvedValue({
      owner: "acme",
      repo: "api",
      prNumber: 3,
      title: "t",
      body: "",
      headSha: "h",
      baseSha: "b",
      files: [{ path: "a.ts", status: "modified", content: "x" }],
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
        findings: [
          {
            agentType: "security",
            severity: "LOW",
            category: "x",
            summary: "s",
            filePath: "a.ts",
            lineStart: 1,
            confidence: 0.8,
            rationale: "r",
          },
        ],
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
});
