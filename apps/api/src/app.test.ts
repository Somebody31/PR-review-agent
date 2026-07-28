import { beforeEach, describe, expect, it, vi } from "vitest";

const listReviews = vi.fn();
const getReviewById = vi.fn();
const eventsSummaryForReview = vi.fn();
const reviewExists = vi.fn();
const listEventsForReview = vi.fn();
const economicsSummary = vi.fn();
const listHitlItems = vi.fn();
const pingDb = vi.fn();
const getDb = vi.fn();
const loadConfig = vi.fn();
const createReviewQueue = vi.fn();

vi.mock("@pr-review/core", () => ({
  loadConfig: (...args: unknown[]) => loadConfig(...args),
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  createReviewQueue: (...args: unknown[]) => createReviewQueue(...args),
  reviewJobId: () => "job-1",
}));

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
  webhookDeliveries: { deliveryId: "delivery_id" },
}));

vi.mock("@pr-review/github", () => ({
  parsePullRequestEvent: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

import { createApp } from "./app.js";

const AUTH = { authorization: "Bearer test-token" };

describe("createApp REST routes", () => {
  beforeEach(() => {
    listReviews.mockReset();
    getReviewById.mockReset();
    eventsSummaryForReview.mockReset();
    reviewExists.mockReset();
    listEventsForReview.mockReset();
    economicsSummary.mockReset();
    listHitlItems.mockReset();
    pingDb.mockReset();
    getDb.mockReset();
    loadConfig.mockReset();
    createReviewQueue.mockReset();

    getDb.mockReturnValue({});
    createReviewQueue.mockReturnValue({ add: vi.fn() });
    loadConfig.mockReturnValue({
      DATABASE_URL: "postgresql://local/test",
      REDIS_URL: "redis://localhost:6379",
      GITHUB_WEBHOOK_SECRET: "whsec",
      API_AUTH_TOKEN: "test-token",
    });
    pingDb.mockResolvedValue(true);
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
});
