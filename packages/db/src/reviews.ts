import { and, eq, isNotNull } from "drizzle-orm";
import type { Finding, ReviewOutcome } from "@pr-review/shared";
import type { Database } from "./client.js";
import { findings, prReviews } from "./schema.js";

export type NewPrReviewInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  installationId: number;
};

export type FinishReviewInput = {
  status: string;
  overallConfidence?: number;
  outcome?: string;
  summaryMarkdown?: string;
  costUsd?: string;
  errorMessage?: string;
  githubReviewId?: string;
};

/** A prior review for the same head that already posted to GitHub. */
export type PostedReviewByHead = {
  id: string;
  githubReviewId: string;
};

/**
 * Insert a pr_reviews row in "running" when the worker starts a job.
 */
export async function insertReviewRunning(
  db: Database,
  input: NewPrReviewInput,
): Promise<string> {
  const rows = await db
    .insert(prReviews)
    .values({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      baseSha: input.baseSha,
      installationId: input.installationId,
      status: "running",
    })
    .returning({ id: prReviews.id });

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("failed to insert pr_reviews row");
  }
  return id;
}

/**
 * Mark review finished (completed / hitl_pending / failed) with optional result fields.
 */
export async function finishReview(
  db: Database,
  reviewId: string,
  input: FinishReviewInput,
): Promise<void> {
  await db
    .update(prReviews)
    .set({
      status: input.status,
      overallConfidence: input.overallConfidence,
      outcome: input.outcome,
      summaryMarkdown: input.summaryMarkdown,
      costUsd: input.costUsd,
      errorMessage: input.errorMessage,
      githubReviewId: input.githubReviewId,
      updatedAt: new Date(),
    })
    .where(eq(prReviews.id, reviewId));
}

/**
 * Persist github_review_id as soon as GitHub accepts the review.
 * Written before finishReview so a crash between post and finish still
 * blocks duplicate posts on retry (findPostedReviewByHead).
 */
export async function setGithubReviewId(
  db: Database,
  reviewId: string,
  githubReviewId: string,
): Promise<void> {
  await db
    .update(prReviews)
    .set({
      githubReviewId,
      updatedAt: new Date(),
    })
    .where(eq(prReviews.id, reviewId));
}

/**
 * Mark review failed with a short error message.
 */
export async function failReview(
  db: Database,
  reviewId: string,
  errorMessage: string,
): Promise<void> {
  await finishReview(db, reviewId, {
    status: "failed",
    errorMessage: errorMessage.slice(0, 2000),
  });
}

/**
 * Persist structured findings for a review.
 */
export async function insertFindings(
  db: Database,
  reviewId: string,
  items: Finding[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const rows = items.map((item) => ({
    reviewId,
    agentType: item.agentType,
    severity: item.severity,
    category: item.category,
    summary: item.summary,
    filePath: item.filePath,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    suggestion: item.suggestion,
    confidence: item.confidence,
    rationale: item.rationale,
  }));

  await db.insert(findings).values(rows);
}

/**
 * Map review outcome to DB status.
 */
export function statusForOutcome(outcome: ReviewOutcome): "completed" | "hitl_pending" {
  if (outcome === "hitl_queue" || outcome === "critical_escalate") {
    return "hitl_pending";
  }
  return "completed";
}

/**
 * Find an already-posted GitHub review for the same PR head SHA.
 * Used so re-runs do not create duplicate PR reviews on GitHub.
 */
export async function findPostedReviewByHead(
  db: Database,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
  },
): Promise<PostedReviewByHead | null> {
  const rows = await db
    .select({
      id: prReviews.id,
      githubReviewId: prReviews.githubReviewId,
    })
    .from(prReviews)
    .where(
      and(
        eq(prReviews.owner, input.owner),
        eq(prReviews.repo, input.repo),
        eq(prReviews.prNumber, input.prNumber),
        eq(prReviews.headSha, input.headSha),
        isNotNull(prReviews.githubReviewId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.githubReviewId) {
    return null;
  }

  return {
    id: row.id,
    githubReviewId: row.githubReviewId,
  };
}
