/**
 * GitHub webhook ingress: rate limit, HMAC verify, delivery idempotency, enqueue.
 */
import type { Context } from "hono";
import {
  createLogger,
  maskSecrets,
  reviewJobId,
  type ReviewQueue,
} from "@pr-review/core";
import {
  webhookDeliveries,
  type Database,
} from "@pr-review/db";
import {
  parsePullRequestEvent,
  verifyWebhookSignature,
} from "@pr-review/github";
import type { ReviewJob } from "@pr-review/shared";
import { eq } from "drizzle-orm";
import { isUniqueViolation } from "./unique-violation.js";

const logger = createLogger({ name: "api-webhook" });

// Light per-IP limit for public webhook path (process-local; fine for single-node MVP)
const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_RATE_MAX = 60;
const webhookHitsByIp = new Map<string, number[]>();

export async function handleGithubWebhook(
  c: Context,
  webhookSecret: string,
  db: Database,
  queue: ReviewQueue,
): Promise<Response> {
  const clientIp = webhookClientIp(c);
  if (!allowWebhookRequest(clientIp)) {
    return c.json({ error: "rate limit exceeded" }, 429);
  }

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

function webhookClientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Sliding-window allow: max WEBHOOK_RATE_MAX hits per IP per WEBHOOK_RATE_WINDOW_MS.
 */
function allowWebhookRequest(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - WEBHOOK_RATE_WINDOW_MS;
  const prior = webhookHitsByIp.get(ip) ?? [];
  const recent: number[] = [];
  for (const ts of prior) {
    if (ts >= windowStart) {
      recent.push(ts);
    }
  }
  if (recent.length >= WEBHOOK_RATE_MAX) {
    webhookHitsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  webhookHitsByIp.set(ip, recent);
  return true;
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
    const safe = maskSecrets(error instanceof Error ? error.message : String(error));
    logger.error({ deliveryId, err: safe }, "failed to record webhook delivery");
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
    const safe = maskSecrets(error instanceof Error ? error.message : String(error));
    logger.error(
      { deliveryId: job.deliveryId, err: safe },
      "failed to enqueue review job",
    );
    await db
      .delete(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, job.deliveryId));
    return false;
  }
}
