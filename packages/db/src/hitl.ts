import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { findings, hitlFeedback, hitlItems, prReviews } from "./schema.js";

/** HITL item plus the review fields needed to post or close. */
export type HitlItemDetail = {
  id: string;
  reviewId: string;
  state: string;
  assignee: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  installationId: number | null;
  summaryMarkdown: string | null;
  status: string;
  githubReviewId: string | null;
};

/** Minimal finding row for dispute + approve post. */
export type FindingRow = {
  id: string;
  reviewId: string;
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

// Shared select shape so getFindingById / listFindingsForReview stay in sync
const findingRowSelect = {
  id: findings.id,
  reviewId: findings.reviewId,
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
};

/**
 * Insert a pending HITL queue row for a review that needs a human decision.
 */
export async function insertHitlItem(
  db: Database,
  reviewId: string,
): Promise<string> {
  const rows = await db
    .insert(hitlItems)
    .values({
      reviewId,
      state: "pending",
    })
    .returning({ id: hitlItems.id });

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("failed to insert hitl_items row");
  }
  return id;
}

/**
 * Load one HITL item joined with its review (for approve / reject).
 */
export async function getHitlItemById(
  db: Database,
  hitlId: string,
): Promise<HitlItemDetail | null> {
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
      headSha: prReviews.headSha,
      installationId: prReviews.installationId,
      summaryMarkdown: prReviews.summaryMarkdown,
      status: prReviews.status,
      githubReviewId: prReviews.githubReviewId,
    })
    .from(hitlItems)
    .innerJoin(prReviews, eq(hitlItems.reviewId, prReviews.id))
    .where(eq(hitlItems.id, hitlId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return row;
}

/**
 * Transition HITL state only from pending.
 * Returns false when another request already claimed the item (idempotent races).
 */
export async function updateHitlState(
  db: Database,
  hitlId: string,
  state: "pending" | "approved" | "rejected",
): Promise<boolean> {
  const rows = await db
    .update(hitlItems)
    .set({
      state,
      updatedAt: new Date(),
    })
    .where(and(eq(hitlItems.id, hitlId), eq(hitlItems.state, "pending")))
    .returning({ id: hitlItems.id });

  return rows.length > 0;
}

/**
 * Load one finding by id (dispute path).
 */
export async function getFindingById(
  db: Database,
  findingId: string,
): Promise<FindingRow | null> {
  const rows = await db
    .select(findingRowSelect)
    .from(findings)
    .where(eq(findings.id, findingId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return row;
}

/**
 * List findings for a review (approve path posts these to GitHub).
 */
export async function listFindingsForReview(
  db: Database,
  reviewId: string,
): Promise<FindingRow[]> {
  const rows = await db
    .select(findingRowSelect)
    .from(findings)
    .where(eq(findings.reviewId, reviewId));

  return rows;
}

/**
 * Store dispute / feedback. Does not change prompts or policy automatically.
 */
export async function insertHitlFeedback(
  db: Database,
  input: {
    reviewId: string;
    findingId: string;
    action: string;
    comment?: string;
  },
): Promise<string> {
  const rows = await db
    .insert(hitlFeedback)
    .values({
      reviewId: input.reviewId,
      findingId: input.findingId,
      action: input.action,
      comment: input.comment,
    })
    .returning({ id: hitlFeedback.id });

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("failed to insert hitl_feedback row");
  }
  return id;
}
