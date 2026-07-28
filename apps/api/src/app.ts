import { Hono } from "hono";
import type { Context } from "hono";
import {
  createLogger,
  createReviewQueue,
  loadConfig,
  reviewJobId,
  type ReviewQueue,
} from "@pr-review/core";
import { getDb, pingDb, webhookDeliveries, type Database } from "@pr-review/db";
import { parsePullRequestEvent, verifyWebhookSignature } from "@pr-review/github";
import type { ReviewJob } from "@pr-review/shared";
import { eq } from "drizzle-orm";
import { isUniqueViolation } from "./unique-violation.js";

const logger = createLogger({ name: "api" });

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

  app.get("/health", async (c: Context): Promise<Response> => {
    const dbOk = await pingDb(databaseUrl);
    return c.json({ ok: true, service: "api", db: dbOk });
  });

  app.post("/webhooks/github", async (c: Context): Promise<Response> => {
    return handleGithubWebhook(c, webhookSecret, db, queue);
  });

  return app;
}

async function handleGithubWebhook(
  c: Context,
  webhookSecret: string,
  db: Database,
  queue: ReviewQueue,
): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  const deliveryId = c.req.header("x-github-delivery");
  const eventName = c.req.header("x-github-event") ?? "";

  const valid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  if (!valid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  if (!deliveryId) {
    return c.json({ error: "missing delivery id" }, 400);
  }

  const deliveryResult = await recordWebhookDelivery(db, deliveryId, eventName);
  if (deliveryResult === "duplicate") {
    logger.info({ deliveryId }, "duplicate webhook delivery ignored");
    return c.json({ ok: true, duplicate: true });
  }
  if (deliveryResult === "error") {
    return c.json({ error: "database error" }, 500);
  }

  if (eventName !== "pull_request") {
    return c.json({ ok: true, ignored: true, reason: "not pull_request" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = parsePullRequestEvent(deliveryId, payload);
  if (!parsed.shouldReview || !parsed.job) {
    return c.json({ ok: true, ignored: true, reason: parsed.reason });
  }

  const enqueued = await enqueueReviewOrRollback(queue, db, parsed.job);
  if (!enqueued) {
    return c.json({ error: "queue error" }, 500);
  }

  logger.info(
    {
      deliveryId,
      owner: parsed.job.owner,
      repo: parsed.job.repo,
      pr: parsed.job.prNumber,
    },
    "enqueued review job",
  );

  return c.json({ ok: true, enqueued: true });
}

/**
 * Insert delivery id for idempotency. "duplicate" means GitHub already delivered this id.
 */
async function recordWebhookDelivery(
  db: Database,
  deliveryId: string,
  eventName: string,
): Promise<"inserted" | "duplicate" | "error"> {
  try {
    await db.insert(webhookDeliveries).values({
      deliveryId,
      eventName,
    });
    return "inserted";
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return "duplicate";
    }
    logger.error({ deliveryId, err: String(error) }, "failed to record webhook delivery");
    return "error";
  }
}

/**
 * Enqueue the review job. If Redis fails after we recorded the delivery,
 * delete the delivery row so GitHub can retry the same delivery id.
 */
async function enqueueReviewOrRollback(
  queue: ReviewQueue,
  db: Database,
  job: ReviewJob,
): Promise<boolean> {
  try {
    await queue.add("review", job, {
      jobId: reviewJobId(job),
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    return true;
  } catch (error: unknown) {
    logger.error(
      { deliveryId: job.deliveryId, err: String(error) },
      "failed to enqueue review job",
    );
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, job.deliveryId));
    return false;
  }
}
