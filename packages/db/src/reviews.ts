import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { prReviews } from "./schema.js";

export type NewPrReviewInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  installationId: number;
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
 * Mark review terminal after context load (agents come in later phases).
 */
export async function completeContextShell(
  db: Database,
  reviewId: string,
  fileCount: number,
): Promise<void> {
  await db
    .update(prReviews)
    .set({
      status: "completed",
      summaryMarkdown: `Context loaded (${fileCount} files). Agents not run yet.`,
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
  await db
    .update(prReviews)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(prReviews.id, reviewId));
}
