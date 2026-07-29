import { beforeEach, describe, expect, it, vi } from "vitest";

const listReviews = vi.fn();
const getReviewById = vi.fn();
const eventsSummaryForReview = vi.fn();
const reviewExists = vi.fn();
const listEventsForReview = vi.fn();
const economicsSummary = vi.fn();
const listHitlItems = vi.fn();
const getHitlItemById = vi.fn();
const updateHitlState = vi.fn();
const listFindingsForReview = vi.fn();
const setGithubReviewId = vi.fn();
const finishReview = vi.fn();
const findPostedReviewByHead = vi.fn();
const emitAgentEvent = vi.fn();
const getFindingById = vi.fn();
const insertHitlFeedback = vi.fn();
const pingDb = vi.fn();
const getDb = vi.fn();
const loadConfig = vi.fn();
const createReviewQueue = vi.fn();
const createGithubApp = vi.fn();
const getInstallationOctokit = vi.fn();
const fetchPrContext = vi.fn();
const postPullRequestReview = vi.fn();

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
    createReviewQueue: (...args: unknown[]) => createReviewQueue(...args),
    reviewJobId: () => "job-1",
  };
});

vi.mock("@pr-review/db", () => ({
  getDb: (...args: unknown[]) => getDb(...args),
  pingDb: (...args: unknown[]) => pingDb(...args),
  listReviews: (...args: unknown[]) => listReviews(...args),
  getReviewById: (...args: unknown[]) => getReviewById(...args),
  eventsSummaryForReview: (...args: unknown[]) => eventsSummaryForReview(...args),
  reviewExists: (...args: unknown[]) => reviewExists(...args),
  listEventsForReview: (...args: unknown[]) => listEventsForReview(...args),
  economicsSummary: (...args: unknown[]) => economicsSummary(...args),
  listHitlItems: (...args: unknown[]) => listHitlItems(...args),
  getHitlItemById: (...args: unknown[]) => getHitlItemById(...args),
  updateHitlState: (...args: unknown[]) => updateHitlState(...args),
  listFindingsForReview: (...args: unknown[]) => listFindingsForReview(...args),
  setGithubReviewId: (...args: unknown[]) => setGithubReviewId(...args),
  finishReview: (...args: unknown[]) => finishReview(...args),
  findPostedReviewByHead: (...args: unknown[]) => findPostedReviewByHead(...args),
  emitAgentEvent: (...args: unknown[]) => emitAgentEvent(...args),
  getFindingById: (...args: unknown[]) => getFindingById(...args),
  insertHitlFeedback: (...args: unknown[]) => insertHitlFeedback(...args),
  webhookDeliveries: { deliveryId: "delivery_id" },
}));

vi.mock("@pr-review/github", () => ({
  parsePullRequestEvent: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  createGithubApp: (...args: unknown[]) => createGithubApp(...args),
  getInstallationOctokit: (...args: unknown[]) => getInstallationOctokit(...args),
  fetchPrContext: (...args: unknown[]) => fetchPrContext(...args),
  postPullRequestReview: (...args: unknown[]) => postPullRequestReview(...args),
}));

import { createApp } from "./app.js";

const AUTH = { authorization: "Bearer test-token" };

const pendingHitl = {
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

describe("createApp REST routes", () => {
  beforeEach(() => {
    listReviews.mockReset();
    getReviewById.mockReset();
    eventsSummaryForReview.mockReset();
    reviewExists.mockReset();
    listEventsForReview.mockReset();
    economicsSummary.mockReset();
    listHitlItems.mockReset();
    getHitlItemById.mockReset();
    updateHitlState.mockReset();
    listFindingsForReview.mockReset();
    setGithubReviewId.mockReset();
    finishReview.mockReset();
    findPostedReviewByHead.mockReset();
    emitAgentEvent.mockReset();
    getFindingById.mockReset();
    insertHitlFeedback.mockReset();
    pingDb.mockReset();
    getDb.mockReset();
    loadConfig.mockReset();
    createReviewQueue.mockReset();
    createGithubApp.mockReset();
    getInstallationOctokit.mockReset();
    fetchPrContext.mockReset();
    postPullRequestReview.mockReset();

    getDb.mockReturnValue({});
    createReviewQueue.mockReturnValue({ add: vi.fn() });
    loadConfig.mockReturnValue({
      DATABASE_URL: "postgresql://local/test",
      REDIS_URL: "redis://localhost:6379",
      GITHUB_WEBHOOK_SECRET: "whsec",
      GITHUB_APP_ID: "1",
      GITHUB_PRIVATE_KEY: "k",
      API_AUTH_TOKEN: "test-token",
    });
    pingDb.mockResolvedValue(true);
    emitAgentEvent.mockResolvedValue("evt-1");
    findPostedReviewByHead.mockResolvedValue(null);
    updateHitlState.mockResolvedValue(true);
  });

  it("GET /health does not require auth", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("api");
  });

  it("GET /api/reviews returns 401 without Bearer token", async () => {
    const app = createApp();
    const res = await app.request("/api/reviews");
    expect(res.status).toBe(401);
  });

  it("GET /api/reviews returns list when authorized", async () => {
    listReviews.mockResolvedValue([{ id: "r1", owner: "acme" }]);
    const app = createApp();
    const res = await app.request("/api/reviews?limit=10", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: unknown[] };
    expect(body.reviews).toHaveLength(1);
    expect(listReviews).toHaveBeenCalledWith({}, 10);
  });

  it("GET /api/reviews/:id returns review + SQL eventsSummary", async () => {
    getReviewById.mockResolvedValue({
      id: "r1",
      owner: "acme",
      findings: [],
    });
    eventsSummaryForReview.mockResolvedValue({ eventCount: 3, costUsd: 0.004 });
    const app = createApp();
    const res = await app.request("/api/reviews/r1", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      review: { id: string };
      eventsSummary: { eventCount: number; costUsd: number };
    };
    expect(body.review.id).toBe("r1");
    expect(body.eventsSummary).toEqual({ eventCount: 3, costUsd: 0.004 });
    expect(eventsSummaryForReview).toHaveBeenCalledWith({}, "r1");
    expect(listEventsForReview).not.toHaveBeenCalled();
  });

  it("GET /api/reviews/:id returns 404 when missing", async () => {
    getReviewById.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request("/api/reviews/missing", { headers: AUTH });
    expect(res.status).toBe(404);
  });

  it("GET /api/reviews/:id/events uses reviewExists not getReviewById", async () => {
    reviewExists.mockResolvedValue(true);
    listEventsForReview.mockResolvedValue([{ id: "e1", eventType: "llm_call" }]);
    const app = createApp();
    const res = await app.request("/api/reviews/r1/events", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviewId: string; events: unknown[] };
    expect(body.reviewId).toBe("r1");
    expect(body.events).toHaveLength(1);
    expect(reviewExists).toHaveBeenCalledWith({}, "r1");
    expect(getReviewById).not.toHaveBeenCalled();
  });

  it("GET /api/reviews/:id/events returns 404 when review missing", async () => {
    reviewExists.mockResolvedValue(false);
    const app = createApp();
    const res = await app.request("/api/reviews/missing/events", { headers: AUTH });
    expect(res.status).toBe(404);
    expect(listEventsForReview).not.toHaveBeenCalled();
  });

  it("GET /api/economics/summary returns rollups", async () => {
    economicsSummary.mockResolvedValue({
      totalCostUsd: 1.5,
      byAgent: [{ agent: "security", costUsd: 1.5 }],
      byDay: [{ day: "2026-07-28", costUsd: 1.5 }],
    });
    const app = createApp();
    const res = await app.request("/api/economics/summary", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalCostUsd: number };
    expect(body.totalCostUsd).toBe(1.5);
  });

  it("GET /api/hitl returns items", async () => {
    listHitlItems.mockResolvedValue([{ id: "h1", reviewId: "r1" }]);
    const app = createApp();
    const res = await app.request("/api/hitl", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it("POST /api/hitl/:id/approve requires auth", async () => {
    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /api/hitl/:id/approve posts to GitHub and marks approved", async () => {
    getHitlItemById.mockResolvedValue(pendingHitl);
    listFindingsForReview.mockResolvedValue([
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
    ]);
    createGithubApp.mockReturnValue({});
    getInstallationOctokit.mockResolvedValue({ rest: { pulls: {} } });
    fetchPrContext.mockResolvedValue({
      files: [{ path: "a.ts", patch: "@@ -1 +1 @@\n+x" }],
    });
    postPullRequestReview.mockResolvedValue({ githubReviewId: "gh-99" });

    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      state: string;
      githubReviewId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.state).toBe("approved");
    expect(body.githubReviewId).toBe("gh-99");
    expect(postPullRequestReview).toHaveBeenCalledTimes(1);
    expect(setGithubReviewId).toHaveBeenCalledWith({}, "r1", "gh-99");
    expect(updateHitlState).toHaveBeenCalledWith({}, "h1", "approved");
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "r1",
      expect.objectContaining({
        status: "completed",
        outcome: "auto_post",
        githubReviewId: "gh-99",
      }),
    );
    // Worker auto-post parity: github_post + hitl_approve
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "github_post",
        agent: "hitl",
        outcome: "posted",
        payload: { githubReviewId: "gh-99" },
      }),
    );
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "hitl_approve",
        outcome: "approved",
      }),
    );
  });

  it("POST /api/hitl/:id/approve skips GitHub when already posted for head", async () => {
    getHitlItemById.mockResolvedValue(pendingHitl);
    findPostedReviewByHead.mockResolvedValue({
      id: "r-other",
      githubReviewId: "gh-existing",
    });

    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { githubReviewId: string };
    expect(body.githubReviewId).toBe("gh-existing");
    expect(postPullRequestReview).not.toHaveBeenCalled();
    expect(setGithubReviewId).toHaveBeenCalledWith({}, "r1", "gh-existing");
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "r1",
      expect.objectContaining({
        status: "completed",
        outcome: "auto_post",
        githubReviewId: "gh-existing",
      }),
    );
    expect(emitAgentEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventType: "github_post",
        agent: "hitl",
        outcome: "skipped_duplicate",
        payload: { githubReviewId: "gh-existing" },
      }),
    );
  });

  it("POST /api/hitl/:id/approve claims pending before posting to GitHub", async () => {
    getHitlItemById.mockResolvedValue(pendingHitl);
    listFindingsForReview.mockResolvedValue([]);
    createGithubApp.mockReturnValue({});
    getInstallationOctokit.mockResolvedValue({ rest: { pulls: {} } });
    fetchPrContext.mockResolvedValue({ files: [] });
    postPullRequestReview.mockResolvedValue({ githubReviewId: "gh-1" });

    const order: string[] = [];
    updateHitlState.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    postPullRequestReview.mockImplementation(async () => {
      order.push("post");
      return { githubReviewId: "gh-1" };
    });

    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    expect(order.indexOf("claim")).toBeLessThan(order.indexOf("post"));
    expect(order[0]).toBe("claim");
  });

  it("POST /api/hitl/:id/approve is idempotent when already approved", async () => {
    getHitlItemById.mockResolvedValue({
      ...pendingHitl,
      state: "approved",
      status: "completed",
      githubReviewId: "gh-99",
    });
    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      alreadyApproved?: boolean;
      githubReviewId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.alreadyApproved).toBe(true);
    expect(body.githubReviewId).toBe("gh-99");
    expect(postPullRequestReview).not.toHaveBeenCalled();
    // Already completed — no second finishReview
    expect(finishReview).not.toHaveBeenCalled();
  });

  it("POST /api/hitl/:id/approve finishes review when approved but still hitl_pending", async () => {
    // Crash after claim before finishReview: HITL approved, review stuck
    getHitlItemById.mockResolvedValue({
      ...pendingHitl,
      state: "approved",
      status: "hitl_pending",
      githubReviewId: "gh-99",
    });
    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyApproved?: boolean };
    expect(body.alreadyApproved).toBe(true);
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "r1",
      expect.objectContaining({
        status: "completed",
        outcome: "auto_post",
        githubReviewId: "gh-99",
      }),
    );
    expect(postPullRequestReview).not.toHaveBeenCalled();
  });

  it("POST /api/hitl/:id/approve returns 409 when rejected", async () => {
    getHitlItemById.mockResolvedValue({ ...pendingHitl, state: "rejected" });
    const app = createApp();
    const res = await app.request("/api/hitl/h1/approve", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(409);
    expect(postPullRequestReview).not.toHaveBeenCalled();
  });

  it("POST /api/hitl/:id/reject closes without posting", async () => {
    getHitlItemById.mockResolvedValue(pendingHitl);
    const app = createApp();
    const res = await app.request("/api/hitl/h1/reject", {
      method: "POST",
      headers: {
        ...AUTH,
        "content-type": "application/json",
      },
      body: JSON.stringify({ comment: "not useful" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; state: string };
    expect(body.ok).toBe(true);
    expect(body.state).toBe("rejected");
    expect(postPullRequestReview).not.toHaveBeenCalled();
    expect(updateHitlState).toHaveBeenCalledWith({}, "h1", "rejected");
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "r1",
      expect.objectContaining({
        status: "completed",
        outcome: "hitl_rejected",
      }),
    );
  });

  it("POST /api/hitl/:id/reject is idempotent when already rejected", async () => {
    getHitlItemById.mockResolvedValue({
      ...pendingHitl,
      state: "rejected",
      status: "completed",
    });
    const app = createApp();
    const res = await app.request("/api/hitl/h1/reject", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      state: string;
      alreadyRejected?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.state).toBe("rejected");
    expect(body.alreadyRejected).toBe(true);
    expect(updateHitlState).not.toHaveBeenCalled();
    expect(finishReview).not.toHaveBeenCalled();
  });

  it("POST /api/hitl/:id/reject finishes review when rejected but still hitl_pending", async () => {
    getHitlItemById.mockResolvedValue({
      ...pendingHitl,
      state: "rejected",
      status: "hitl_pending",
    });
    const app = createApp();
    const res = await app.request("/api/hitl/h1/reject", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyRejected?: boolean };
    expect(body.alreadyRejected).toBe(true);
    expect(finishReview).toHaveBeenCalledWith(
      {},
      "r1",
      expect.objectContaining({
        status: "completed",
        outcome: "hitl_rejected",
      }),
    );
  });

  it("POST /api/findings/:id/dispute stores feedback", async () => {
    getFindingById.mockResolvedValue({
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
    });
    insertHitlFeedback.mockResolvedValue("fb-1");

    const app = createApp();
    const res = await app.request("/api/findings/f1/dispute", {
      method: "POST",
      headers: {
        ...AUTH,
        "content-type": "application/json",
      },
      body: JSON.stringify({ comment: "false positive" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      feedbackId: string;
      action: string;
    };
    expect(body.ok).toBe(true);
    expect(body.feedbackId).toBe("fb-1");
    expect(body.action).toBe("dispute");
    expect(insertHitlFeedback).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        reviewId: "r1",
        findingId: "f1",
        action: "dispute",
        comment: "false positive",
      }),
    );
  });

  it("POST /api/findings/:id/dispute returns 404 when finding missing", async () => {
    getFindingById.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request("/api/findings/missing/dispute", {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(404);
  });
});

describe("webhook rate limit", () => {
  beforeEach(() => {
    getDb.mockReset();
    loadConfig.mockReset();
    createReviewQueue.mockReset();
    getDb.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    createReviewQueue.mockReturnValue({ add: vi.fn() });
    loadConfig.mockReturnValue({
      DATABASE_URL: "postgresql://local/test",
      REDIS_URL: "redis://localhost:6379",
      GITHUB_WEBHOOK_SECRET: "whsec",
      GITHUB_APP_ID: "1",
      GITHUB_PRIVATE_KEY: "k",
      API_AUTH_TOKEN: "test-token",
    });
  });

  it("POST /webhooks/github returns 429 after per-IP limit (60/min)", async () => {
    const app = createApp();
    // Unique key per run so the process-local sliding window does not collide
    const ip = `rate-test-cap-${Date.now()}-${Math.random()}`;
    const headers = {
      "x-forwarded-for": ip,
      "content-type": "application/json",
    };
    const body = "{}";

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/webhooks/github", {
        method: "POST",
        headers,
        body,
      });
      // Under the cap: signature check runs (401 without valid sig), never 429
      expect(res.status).not.toBe(429);
    }

    const limited = await app.request("/webhooks/github", {
      method: "POST",
      headers,
      body,
    });
    expect(limited.status).toBe(429);
    const limitedBody = (await limited.json()) as { error: string };
    expect(limitedBody.error).toMatch(/rate limit/i);
  });

  it("POST /webhooks/github rate limit is per IP", async () => {
    const app = createApp();
    const stamp = `${Date.now()}-${Math.random()}`;
    const limitedIp = `rate-test-a-${stamp}`;
    const otherIp = `rate-test-b-${stamp}`;

    for (let i = 0; i < 60; i++) {
      await app.request("/webhooks/github", {
        method: "POST",
        headers: { "x-forwarded-for": limitedIp },
        body: "{}",
      });
    }
    const blocked = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "x-forwarded-for": limitedIp },
      body: "{}",
    });
    expect(blocked.status).toBe(429);

    const other = await app.request("/webhooks/github", {
      method: "POST",
      headers: { "x-forwarded-for": otherIp },
      body: "{}",
    });
    expect(other.status).not.toBe(429);
  });
});
