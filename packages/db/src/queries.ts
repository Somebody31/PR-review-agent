import { desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { findings, hitlItems, prReviews } from "./schema.js";

/** Compact review row for list endpoints. */
export type ReviewListItem = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  status: string;
  overallConfidence: number | null;
  outcome: string | null;
  costUsd: string | null;
  githubReviewId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Finding row for review detail. */
export type FindingListItem = {
  id: string;
  agentType: string;
  severity: string;
  category: string;
  summary: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  suggestion: string | null;
  confidence: number;
  rationale: string;
};

/** Full review detail for GET /api/reviews/:id. */
export type ReviewDetail = ReviewListItem & {
  baseSha: string | null;
  summaryMarkdown: string | null;
  errorMessage: string | null;
  findings: FindingListItem[];
};

/** HITL queue row for GET /api/hitl. */
export type HitlListItem = {
  id: string;
  reviewId: string;
  state: string;
  assignee: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
};

/**
 * List recent reviews, newest first.
 */
export async function listReviews(
  db: Database,
  limit: number = 50,
): Promise<ReviewListItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  const rows = await db
    .select({
      id: prReviews.id,
      owner: prReviews.owner,
      repo: prReviews.repo,
      prNumber: prReviews.prNumber,
      headSha: prReviews.headSha,
      status: prReviews.status,
      overallConfidence: prReviews.overallConfidence,
      outcome: prReviews.outcome,
      costUsd: prReviews.costUsd,
      githubReviewId: prReviews.githubReviewId,
      createdAt: prReviews.createdAt,
      updatedAt: prReviews.updatedAt,
    })
    .from(prReviews)
    .orderBy(desc(prReviews.createdAt))
    .limit(safeLimit);

  return rows;
}

/**
 * True when a pr_reviews row exists (no findings join — existence checks only).
 */
export async function reviewExists(db: Database, reviewId: string): Promise<boolean> {
  const rows = await db
    .select({ id: prReviews.id })
    .from(prReviews)
    .where(eq(prReviews.id, reviewId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Load one review with its findings. Returns null if missing.
 */
export async function getReviewById(
  db: Database,
  reviewId: string,
): Promise<ReviewDetail | null> {
  const reviewRows = await db
    .select({
      id: prReviews.id,
      owner: prReviews.owner,
      repo: prReviews.repo,
      prNumber: prReviews.prNumber,
      headSha: prReviews.headSha,
      baseSha: prReviews.baseSha,
      status: prReviews.status,
      overallConfidence: prReviews.overallConfidence,
      outcome: prReviews.outcome,
      summaryMarkdown: prReviews.summaryMarkdown,
      costUsd: prReviews.costUsd,
      errorMessage: prReviews.errorMessage,
      githubReviewId: prReviews.githubReviewId,
      createdAt: prReviews.createdAt,
      updatedAt: prReviews.updatedAt,
    })
    .from(prReviews)
    .where(eq(prReviews.id, reviewId))
    .limit(1);

  const review = reviewRows[0];
  if (!review) {
    return null;
  }

  const findingRows = await db
    .select({
      id: findings.id,
      agentType: findings.agentType,
      severity: findings.severity,
      category: findings.category,
      summary: findings.summary,
      filePath: findings.filePath,
      lineStart: findings.lineStart,
      lineEnd: findings.lineEnd,
      suggestion: findings.suggestion,
      confidence: findings.confidence,
      rationale: findings.rationale,
    })
    .from(findings)
    .where(eq(findings.reviewId, reviewId));

  return {
    ...review,
    findings: findingRows,
  };
}

/**
 * List HITL queue items (read-only for Phase 7). Newest first.
 */
export async function listHitlItems(
  db: Database,
  limit: number = 50,
): Promise<HitlListItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  const rows = await db
    .select({
      id: hitlItems.id,
      reviewId: hitlItems.reviewId,
      state: hitlItems.state,
      assignee: hitlItems.assignee,
      createdAt: hitlItems.createdAt,
      updatedAt: hitlItems.updatedAt,
      owner: prReviews.owner,
      repo: prReviews.repo,
      prNumber: prReviews.prNumber,
    })
    .from(hitlItems)
    .leftJoin(prReviews, eq(hitlItems.reviewId, prReviews.id))
    .orderBy(desc(hitlItems.createdAt))
    .limit(safeLimit);

  return rows;
}
