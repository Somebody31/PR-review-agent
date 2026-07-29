import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewJob } from "@pr-review/shared";
import { handleReviewJob } from "./handle-review-job.js";

const insertReviewRunning = vi.fn();
const insertFindings = vi.fn();
const insertHitlItem = vi.fn();
const finishReview = vi.fn();
const failReview = vi.fn();
const findPostedReviewByHead = vi.fn();
const setGithubReviewId = vi.fn();
const getDb = vi.fn();
const emitAgentEvent = vi.fn();
const sumCostUsdUtcDay = vi.fn();
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
  insertHitlItem: (...args: unknown[]) => insertHitlItem(...args),
  finishReview: (...args: unknown[]) => finishReview(...args),
  failReview: (...args: unknown[]) => failReview(...args),
  findPostedReviewByHead: (...args: unknown[]) => findPostedReviewByHead(...args),
  setGithubReviewId: (...args: unknown[]) => setGithubReviewId(...args),
  emitAgentEvent: (...args: unknown[]) => emitAgentEvent(...args),
  sumCostUsdUtcDay: (...args: unknown[]) => sumCostUsdUtcDay(...args),
  getDb: (...args: unknown[]) => getDb(...args),
  statusForOutcome: (outcome: string) =>
    outcome === "hitl_queue" || outcome === "critical_escalate"
      ? "hitl_pending"
      : "completed",
}));

vi.mock("@pr-review/agents", () => ({
  runReviewGraph: (...args: unknown[]) => runReviewGraph(...args),
  isOverBudget: (spentUsd: number, estimateUsd: number, dailyBudgetUsd: number) =>
    spentUsd + estimateUsd > dailyBudgetUsd,
  createBudgetExceededError: (
    spentUsd: number,
    estimateUsd: number,
    dailyBudgetUsd: number,
  ) => {
    const error = new Error("budget") as Error & {
      spentUsd: number;
      estimateUsd: number;
      dailyBudgetUsd: number;
    };
    error.name = "BudgetExceededError";
    error.spentUsd = spentUsd;
    error.estimateUsd = estimateUsd;
    error.dailyBudgetUsd = dailyBudgetUsd;
    return error;
  },
  isBudgetExceededError: (error: unknown) =>
    error instanceof Error && error.name === "BudgetExceededError",
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
    insertHitlItem.mockReset();
    finishReview.mockReset();
    failReview.mockReset();
    findPostedReviewByHead.mockReset();
    setGithubReviewId.mockReset();
    emitAgentEvent.mockReset();
    sumCostUsdUtcDay.mockReset();
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
    insertHitlItem.mockResolvedValue("hitl-1");
    findPostedReviewByHead.mockResolvedValue(null);
    setGithubReviewId.mockResolvedValue(undefined);
    emitAgentEvent.mockResolvedValue("evt-1");
    sumCostUsdUtcDay.mockResolvedValue(0);
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
      DAILY_BUDGET_USD: 20,
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
      totalCostUsd: 0.004,
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
        hooks: expect.objectContaining({
          onEvent: expect.any(Function),
          checkBudget: expect.any(Function),
        }),
      }),
    );
    expect(insertFindings).toHaveBeenCalled();
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "review-1",
      expect.objectContaining({
        status: "hitl_pending",
        outcome: "hitl_queue",
        costUsd: "0.004",
      }),
    );
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ eventType: "review_start", reviewId: "review-1" }),
    );
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ eventType: "review_end", reviewId: "review-1" }),
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

  it("inserts hitl_items when outcome is hitl_queue", async () => {
    await handleReviewJob(job);

    expect(insertHitlItem).toHaveBeenCalledWith({}, "review-1");
  });

  it("inserts hitl_items when outcome is critical_escalate", async () => {
    runReviewGraph.mockResolvedValue({
      result: {
        reviewId: "review-1",
        prNumber: 3,
        repo: "acme/api",
        findings: [
          {
            ...sampleFinding,
            severity: "CRITICAL",
            category: "rce",
          },
        ],
        overallConfidence: 0.95,
        outcome: "critical_escalate",
        summaryMarkdown: "critical",
      },
      agentTimings: [],
      totalCostUsd: 0,
    });

    await handleReviewJob(job);

    expect(insertHitlItem).toHaveBeenCalledWith({}, "review-1");
    expect(postPullRequestReview).not.toHaveBeenCalled();
  });

  it("does not insert hitl_items on auto_post", async () => {
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
      totalCostUsd: 0,
    });
    postPullRequestReview.mockResolvedValue({ githubReviewId: "gh-42" });

    await handleReviewJob(job);

    expect(insertHitlItem).not.toHaveBeenCalled();
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
      totalCostUsd: 0.01,
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
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "github_post",
        outcome: "posted",
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
      totalCostUsd: 0,
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
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "github_post",
        outcome: "skipped_duplicate",
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
      totalCostUsd: 0.01,
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

  it("marks review failed when graph throws BudgetExceededError", async () => {
    const { createBudgetExceededError } = await import("@pr-review/agents");
    runReviewGraph.mockRejectedValue(createBudgetExceededError(20, 0.01, 20));

    await expect(handleReviewJob(job)).rejects.toThrow(/budget/i);

    expect(failReview).toHaveBeenCalled();
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "review_failed",
        payload: expect.objectContaining({ budgetExceeded: true }),
      }),
    );
  });

  it("emits budget_block and throws when checkBudget is over cap", async () => {
    sumCostUsdUtcDay.mockResolvedValue(20);
    let hooks: { checkBudget?: (estimateUsd: number) => Promise<void> } | undefined;
    runReviewGraph.mockImplementation(async (args: { hooks?: typeof hooks }) => {
      hooks = args.hooks;
      if (hooks?.checkBudget) {
        await hooks.checkBudget(0.01);
      }
      return {
        result: {
          reviewId: "review-1",
          prNumber: 3,
          repo: "acme/api",
          findings: [],
          overallConfidence: 0,
          outcome: "hitl_queue",
          summaryMarkdown: "x",
        },
        agentTimings: [],
        totalCostUsd: 0,
      };
    });

    await expect(handleReviewJob(job)).rejects.toThrow(/budget/i);

    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "budget_block",
        agent: "budget",
        payload: expect.objectContaining({
          spentUsd: 20,
          estimateUsd: 0.01,
          dailyBudgetUsd: 20,
        }),
      }),
    );
    expect(failReview).toHaveBeenCalled();
  });

  it("does not put costUsd on review_end (billable only on llm_call)", async () => {
    await handleReviewJob(job);

    const reviewEndCall = emitAgentEvent.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { eventType?: string }).eventType === "review_end",
    );
    expect(reviewEndCall).toBeDefined();
    const payload = reviewEndCall?.[1] as {
      costUsd?: number | null;
      payload?: { totalCostUsd?: number };
    };
    expect(payload.costUsd).toBeUndefined();
    expect(payload.payload?.totalCostUsd).toBe(0.004);
  });
});
