import { Hono } from "hono";
import type { Context } from "hono";
import {
  createLogger,
  createReviewQueue,
  loadConfig,
  maskSecrets,
  reviewJobId,
  withRetry,
  type AppConfig,
  type ReviewQueue,
} from "@pr-review/core";
import {
  emitAgentEvent,
  findPostedReviewByHead,
  finishReview,
  getDb,
  getFindingById,
  getHitlItemById,
  getReviewById,
  economicsSummary,
  eventsSummaryForReview,
  insertHitlFeedback,
  listEventsForReview,
  listFindingsForReview,
  listHitlItems,
  listReviews,
  pingDb,
  reviewExists,
  setGithubReviewId,
  updateHitlState,
  webhookDeliveries,
  type Database,
  type FindingRow,
  type HitlItemDetail,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
  parsePullRequestEvent,
  postPullRequestReview,
  verifyWebhookSignature,
} from "@pr-review/github";
import { findingSchema, type Finding, type ReviewJob } from "@pr-review/shared";
import { eq } from "drizzle-orm";
import { requireApiAuth } from "./auth.js";
import { isUniqueViolation } from "./unique-violation.js";

const logger = createLogger({ name: "api" });

// Light per-IP limit for public webhook path (process-local; fine for single-node MVP)
const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_RATE_MAX = 60;
const webhookHitsByIp = new Map<string, number[]>();

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

/**
 * Human approved: claim pending→approved first, then post (idempotent by head SHA).
 * Claim-before-post so a concurrent reject cannot leave GitHub posted while HITL is rejected.
 */
async function approveHitlItem(
  c: Context,
  db: Database,
  config: AppConfig,
  hitlId: string,
): Promise<Response> {
  try {
    const item = await getHitlItemById(db, hitlId);
    if (!item) {
      return c.json({ error: "not found" }, 404);
    }

    // Retry / crash recovery: approved but post or finishReview may still be missing
    if (item.state === "approved") {
      return completeApprovedHitl(c, db, config, item, true);
    }
    if (item.state !== "pending") {
      return c.json({ error: `hitl item is already ${item.state}` }, 409);
    }
    if (item.installationId === null || item.installationId === undefined) {
      return c.json({ error: "review has no installation id; cannot post" }, 400);
    }

    // Claim first — only the winner may post to GitHub
    const claimed = await updateHitlState(db, hitlId, "approved");
    if (!claimed) {
      const latest = await getHitlItemById(db, hitlId);
      if (latest?.state === "approved") {
        return completeApprovedHitl(c, db, config, latest, true);
      }
      return c.json({ error: "hitl item is no longer pending" }, 409);
    }

    const claimedItem: HitlItemDetail = { ...item, state: "approved" };
    return completeApprovedHitl(c, db, config, claimedItem, false);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const safe = maskSecrets(message);
    logger.error({ hitlId, err: safe }, "HITL approve failed");
    return c.json({ error: safe }, 500);
  }
}

/**
 * After HITL is approved: post if needed, then finishReview when review is not terminal.
 * Safe to call again after a crash between claim, post, and finish.
 */
async function completeApprovedHitl(
  c: Context,
  db: Database,
  config: AppConfig,
  item: HitlItemDetail,
  alreadyApproved: boolean,
): Promise<Response> {
  const githubReviewId = await postHitlReviewIfNeeded(db, config, item);

  // Crash after claim/post before finish left status hitl_pending — heal on retry
  if (item.status !== "completed") {
    await finishReview(db, item.reviewId, {
      status: "completed",
      outcome: "auto_post",
      githubReviewId,
    });
  }

  if (!alreadyApproved) {
    await emitAgentEvent(db, {
      reviewId: item.reviewId,
      eventType: "hitl_approve",
      agent: "hitl",
      outcome: "approved",
      payload: { hitlId: item.id, githubReviewId },
    });
    logger.info(
      { hitlId: item.id, reviewId: item.reviewId, githubReviewId },
      "HITL approved and review posted",
    );
  }

  return c.json({
    ok: true,
    hitlId: item.id,
    reviewId: item.reviewId,
    state: "approved",
    githubReviewId,
    ...(alreadyApproved ? { alreadyApproved: true } : {}),
  });
}

/**
 * Post to GitHub unless this head (or row) already has a github_review_id.
 * Mirrors worker maybePostGithubReview short-circuit for Phase 6 post safety.
 */
async function postHitlReviewIfNeeded(
  db: Database,
  config: AppConfig,
  item: HitlItemDetail,
): Promise<string> {
  if (item.githubReviewId) {
    return item.githubReviewId;
  }

  const existing = await findPostedReviewByHead(db, {
    owner: item.owner,
    repo: item.repo,
    prNumber: item.prNumber,
    headSha: item.headSha,
  });
  if (existing) {
    await setGithubReviewId(db, item.reviewId, existing.githubReviewId);
    // Parity with worker maybePostGithubReview (timeline / cost)
    await emitAgentEvent(db, {
      reviewId: item.reviewId,
      eventType: "github_post",
      agent: "hitl",
      outcome: "skipped_duplicate",
      payload: { githubReviewId: existing.githubReviewId },
    });
    return existing.githubReviewId;
  }

  if (item.installationId === null || item.installationId === undefined) {
    throw new Error("review has no installation id; cannot post");
  }

  const findingRows = await listFindingsForReview(db, item.reviewId);
  const findings = findingRowsToShared(findingRows);

  const app = createGithubApp(config.GITHUB_APP_ID, config.GITHUB_PRIVATE_KEY);
  const octokit = await getInstallationOctokit(app, item.installationId);
  const context = await fetchPrContext(octokit, {
    owner: item.owner,
    repo: item.repo,
    prNumber: item.prNumber,
  });

  const posted = await withRetry(
    () =>
      postPullRequestReview(octokit, {
        owner: item.owner,
        repo: item.repo,
        prNumber: item.prNumber,
        headSha: item.headSha,
        findings,
        summaryMarkdown: item.summaryMarkdown ?? "",
        files: context.files,
      }),
    {
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 5000,
    },
  );

  // Persist id before finishReview so a crash still blocks duplicate posts
  await setGithubReviewId(db, item.reviewId, posted.githubReviewId);

  // Parity with worker maybePostGithubReview
  await emitAgentEvent(db, {
    reviewId: item.reviewId,
    eventType: "github_post",
    agent: "hitl",
    outcome: "posted",
    payload: { githubReviewId: posted.githubReviewId },
  });

  return posted.githubReviewId;
}

/**
 * Human rejected: claim pending→rejected, close without posting to GitHub.
 * Already-rejected retries finish the review if a prior crash left hitl_pending.
 */
async function rejectHitlItem(
  c: Context,
  db: Database,
  hitlId: string,
): Promise<Response> {
  try {
    const item = await getHitlItemById(db, hitlId);
    if (!item) {
      return c.json({ error: "not found" }, 404);
    }

    // Idempotent reject: heal stuck hitl_pending after claim-before-finish crash
    if (item.state === "rejected") {
      return completeRejectedHitl(c, db, item, true);
    }
    if (item.state !== "pending") {
      return c.json({ error: `hitl item is already ${item.state}` }, 409);
    }

    const comment = await parseOptionalComment(c);

    const claimed = await updateHitlState(db, hitlId, "rejected");
    if (!claimed) {
      const latest = await getHitlItemById(db, hitlId);
      if (latest?.state === "rejected") {
        return completeRejectedHitl(c, db, latest, true);
      }
      return c.json({ error: "hitl item is no longer pending" }, 409);
    }

    // Terminal reject: completed + explicit outcome (not leftover hitl_queue)
    await finishReview(db, item.reviewId, {
      status: "completed",
      outcome: "hitl_rejected",
    });

    await emitAgentEvent(db, {
      reviewId: item.reviewId,
      eventType: "hitl_reject",
      agent: "hitl",
      outcome: "rejected",
      payload: {
        hitlId,
        comment: comment ? maskSecrets(comment).slice(0, 500) : null,
      },
    });

    logger.info({ hitlId, reviewId: item.reviewId }, "HITL rejected without post");

    return c.json({
      ok: true,
      hitlId,
      reviewId: item.reviewId,
      state: "rejected",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const safe = maskSecrets(message);
    logger.error({ hitlId, err: safe }, "HITL reject failed");
    return c.json({ error: safe }, 500);
  }
}

/**
 * Ensure a rejected HITL review is terminal completed + hitl_rejected.
 */
async function completeRejectedHitl(
  c: Context,
  db: Database,
  item: HitlItemDetail,
  alreadyRejected: boolean,
): Promise<Response> {
  if (item.status !== "completed") {
    await finishReview(db, item.reviewId, {
      status: "completed",
      outcome: "hitl_rejected",
    });
  }

  return c.json({
    ok: true,
    hitlId: item.id,
    reviewId: item.reviewId,
    state: "rejected",
    ...(alreadyRejected ? { alreadyRejected: true } : {}),
  });
}

/**
 * Developer disputes a finding — store feedback only (no auto prompt change).
 */
async function disputeFinding(
  c: Context,
  db: Database,
  findingId: string,
): Promise<Response> {
  try {
    const finding = await getFindingById(db, findingId);
    if (!finding) {
      return c.json({ error: "not found" }, 404);
    }

    const comment = await parseOptionalComment(c);

    const feedbackId = await insertHitlFeedback(db, {
      reviewId: finding.reviewId,
      findingId: finding.id,
      action: "dispute",
      comment: comment ? maskSecrets(comment) : undefined,
    });

    await emitAgentEvent(db, {
      reviewId: finding.reviewId,
      eventType: "finding_dispute",
      agent: "hitl",
      outcome: "dispute",
      payload: {
        findingId: finding.id,
        feedbackId,
        comment: comment ? maskSecrets(comment).slice(0, 500) : null,
      },
    });

    logger.info(
      { findingId, reviewId: finding.reviewId, feedbackId },
      "finding disputed",
    );

    return c.json({
      ok: true,
      feedbackId,
      findingId: finding.id,
      reviewId: finding.reviewId,
      action: "dispute",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const safe = maskSecrets(message);
    logger.error({ findingId, err: safe }, "finding dispute failed");
    return c.json({ error: safe }, 500);
  }
}

/**
 * Optional JSON body `{ "comment": "..." }` for reject / dispute. Empty body is fine.
 */
async function parseOptionalComment(c: Context): Promise<string | undefined> {
  try {
    const body = (await c.req.json()) as { comment?: unknown };
    if (typeof body.comment === "string" && body.comment.trim().length > 0) {
      return body.comment.trim().slice(0, 2000);
    }
  } catch {
    // empty body is fine
  }
  return undefined;
}

/**
 * Map DB finding rows to shared Finding type for GitHub post.
 * Validates enums/fields via findingSchema (no unchecked casts).
 */
function findingRowsToShared(rows: FindingRow[]): Finding[] {
  const out: Finding[] = [];
  for (const row of rows) {
    const candidate: Record<string, unknown> = {
      agentType: row.agentType,
      severity: row.severity,
      category: row.category,
      summary: row.summary,
      filePath: row.filePath,
      lineStart: row.lineStart,
      confidence: row.confidence,
      rationale: row.rationale,
    };
    if (row.lineEnd !== null && row.lineEnd !== undefined) {
      candidate.lineEnd = row.lineEnd;
    }
    if (row.suggestion) {
      candidate.suggestion = row.suggestion;
    }
    const parsed = findingSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `invalid finding row ${row.id}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    out.push(parsed.data);
  }
  return out;
}

async function handleGithubWebhook(
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
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, job.deliveryId));
    return false;
  }
}
