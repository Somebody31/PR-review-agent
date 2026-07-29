/**
 * HTTP route map only — handlers live in webhook-handlers / hitl-handlers.
 * Keeps the entry surface short so a beginner can see every URL at a glance.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import {
  createReviewQueue,
  loadConfig,
} from "@pr-review/core";
import {
  economicsSummary,
  eventsSummaryForReview,
  getDb,
  getReviewById,
  listEventsForReview,
  listHitlItems,
  listReviews,
  pingDb,
  reviewExists,
} from "@pr-review/db";
import { requireApiAuth } from "./auth.js";
import {
  approveHitlItem,
  disputeFinding,
  rejectHitlItem,
} from "./hitl-handlers.js";
import { handleGithubWebhook } from "./webhook-handlers.js";

/**
 * Build the Hono routes. Separated from serve() so process bootstrap stays in index.ts.
 */
export function createApp(): Hono {
  const config = loadConfig();
  const app = new Hono();
  const queue = createReviewQueue(config.REDIS_URL);
  const db = getDb(config.DATABASE_URL);
  const webhookSecret = config.GITHUB_WEBHOOK_SECRET;
  const databaseUrl = config.DATABASE_URL;
  const apiAuthToken = config.API_AUTH_TOKEN;

  app.get("/health", async (c: Context): Promise<Response> => {
    const dbOk = await pingDb(databaseUrl);
    return c.json({ ok: true, service: "api", db: dbOk });
  });

  app.post("/webhooks/github", async (c: Context): Promise<Response> => {
    return handleGithubWebhook(c, webhookSecret, db, queue);
  });

  // --- REST API (Bearer API_AUTH_TOKEN) ---

  app.get("/api/reviews", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    const reviews = await listReviews(db, Number.isFinite(limit) ? limit : 50);
    return c.json({ reviews });
  });

  app.get("/api/reviews/:id", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const id = c.req.param("id") ?? "";
    if (!id) {
      return c.json({ error: "missing review id" }, 400);
    }
    const review = await getReviewById(db, id);
    if (!review) {
      return c.json({ error: "not found" }, 404);
    }
    // SQL aggregate only (event count + llm_call billable cost) — not the full timeline
    const eventsSummary = await eventsSummaryForReview(db, id);
    return c.json({
      review,
      eventsSummary,
    });
  });

  app.get("/api/reviews/:id/events", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const id = c.req.param("id") ?? "";
    if (!id) {
      return c.json({ error: "missing review id" }, 400);
    }
    // Existence only — avoid loading findings just to gate the timeline
    const exists = await reviewExists(db, id);
    if (!exists) {
      return c.json({ error: "not found" }, 404);
    }
    const events = await listEventsForReview(db, id);
    return c.json({ reviewId: id, events });
  });

  app.get("/api/economics/summary", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const summary = await economicsSummary(db);
    return c.json(summary);
  });

  app.get("/api/hitl", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    const items = await listHitlItems(db, Number.isFinite(limit) ? limit : 50);
    return c.json({ items });
  });

  app.post("/api/hitl/:id/approve", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const hitlId = c.req.param("id") ?? "";
    if (!hitlId) {
      return c.json({ error: "missing hitl id" }, 400);
    }
    return approveHitlItem(c, db, config, hitlId);
  });

  app.post("/api/hitl/:id/reject", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const hitlId = c.req.param("id") ?? "";
    if (!hitlId) {
      return c.json({ error: "missing hitl id" }, 400);
    }
    return rejectHitlItem(c, db, hitlId);
  });

  app.post("/api/findings/:id/dispute", async (c: Context): Promise<Response> => {
    const denied = requireApiAuth(c, apiAuthToken);
    if (denied) {
      return denied;
    }
    const findingId = c.req.param("id") ?? "";
    if (!findingId) {
      return c.json({ error: "missing finding id" }, 400);
    }
    return disputeFinding(c, db, findingId);
  });

  return app;
}
