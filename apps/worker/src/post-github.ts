/**
 * Auto-post path for auto_post outcomes only. Idempotent by head SHA.
 */
import { createLogger, withRetry } from "@pr-review/core";
import {
  emitAgentEvent,
  findPostedReviewByHead,
  setGithubReviewId,
  type Database,
} from "@pr-review/db";
import {
  postPullRequestReview,
  type PrFile,
  type ReviewsOctokit,
} from "@pr-review/github";
import type { ReviewJob, ReviewResult } from "@pr-review/shared";

const logger = createLogger({ name: "worker-post" });

/**
 * Post a GitHub review only for auto_post outcomes.
 * Skips the API call when the same head SHA already has a stored github_review_id.
 */
export async function maybePostGithubReview(args: {
  db: Database;
  octokit: ReviewsOctokit;
  job: ReviewJob;
  result: ReviewResult;
  reviewId: string;
  files: PrFile[];
}): Promise<string | undefined> {
  if (args.result.outcome !== "auto_post") {
    return undefined;
  }

  const existing = await findPostedReviewByHead(args.db, {
    owner: args.job.owner,
    repo: args.job.repo,
    prNumber: args.job.prNumber,
    headSha: args.job.headSha,
  });

  if (existing) {
    logger.info(
      {
        reviewId: args.reviewId,
        existingReviewId: existing.id,
        githubReviewId: existing.githubReviewId,
      },
      "skipping GitHub post; already posted for this head",
    );
    await emitAgentEvent(args.db, {
      reviewId: args.reviewId,
      eventType: "github_post",
      agent: "worker",
      outcome: "skipped_duplicate",
      payload: { githubReviewId: existing.githubReviewId },
    });
    return existing.githubReviewId;
  }

  const posted = await withRetry(
    () =>
      postPullRequestReview(args.octokit, {
        owner: args.job.owner,
        repo: args.job.repo,
        prNumber: args.job.prNumber,
        headSha: args.job.headSha,
        findings: args.result.findings,
        summaryMarkdown: args.result.summaryMarkdown,
        files: args.files,
      }),
    {
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 5000,
    },
  );

  // Persist id before finishReview so a crash still blocks duplicate posts
  await setGithubReviewId(args.db, args.reviewId, posted.githubReviewId);

  await emitAgentEvent(args.db, {
    reviewId: args.reviewId,
    eventType: "github_post",
    agent: "worker",
    outcome: "posted",
    payload: { githubReviewId: posted.githubReviewId },
  });

  logger.info(
    { reviewId: args.reviewId, githubReviewId: posted.githubReviewId },
    "GitHub review posted",
  );
  return posted.githubReviewId;
}
