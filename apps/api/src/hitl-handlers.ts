/**
 * HITL write paths: approve (claim → post → finish), reject, dispute.
 * Kept separate from route wiring so app.ts stays a short map of URLs → handlers.
 */
import type { Context } from "hono";
import {
  createLogger,
  maskSecrets,
  withRetry,
  type AppConfig,
} from "@pr-review/core";
import {
  emitAgentEvent,
  findPostedReviewByHead,
  finishReview,
  getFindingById,
  getHitlItemById,
  insertHitlFeedback,
  listFindingsForReview,
  setGithubReviewId,
  updateHitlState,
  type Database,
  type FindingRow,
  type HitlItemDetail,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
  postPullRequestReview,
} from "@pr-review/github";
import { findingSchema, type Finding } from "@pr-review/shared";

const logger = createLogger({ name: "api-hitl" });

/**
 * Human approved: claim pending→approved first, then post (idempotent by head SHA).
 * Claim-before-post so a concurrent reject cannot leave GitHub posted while HITL is rejected.
 */
export async function approveHitlItem(
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
export async function rejectHitlItem(
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
export async function disputeFinding(
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
