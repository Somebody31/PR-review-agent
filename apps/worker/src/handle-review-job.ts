import { createLogger, loadConfig } from "@pr-review/core";
import {
  completeContextShell,
  failReview,
  getDb,
  insertReviewRunning,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
} from "@pr-review/github";
import type { ReviewJob } from "@pr-review/shared";

const logger = createLogger({ name: "worker" });

/**
 * Phase 3: create review shell, fetch PR context from GitHub, mark terminal.
 * Later phases run LangGraph agents on the same path.
 */
export async function handleReviewJob(job: ReviewJob): Promise<void> {
  const config = loadConfig();
  const db = getDb(config.DATABASE_URL);
  const reviewId = await insertReviewRunning(db, {
    owner: job.owner,
    repo: job.repo,
    prNumber: job.prNumber,
    headSha: job.headSha,
    baseSha: job.baseSha,
    installationId: job.installationId,
  });

  logger.info(
    {
      reviewId,
      deliveryId: job.deliveryId,
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      headSha: job.headSha,
    },
    "review shell created",
  );

  try {
    const app = createGithubApp(config.GITHUB_APP_ID, config.GITHUB_PRIVATE_KEY);
    const octokit = await getInstallationOctokit(app, job.installationId);
    const context = await fetchPrContext(octokit, {
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
    });

    await completeContextShell(db, reviewId, context.files.length);

    logger.info(
      {
        reviewId,
        title: context.title,
        fileCount: context.files.length,
        headSha: context.headSha,
      },
      "PR context loaded",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await failReview(db, reviewId, message);
    logger.error({ reviewId, err: message }, "review failed while loading context");
    throw error;
  }
}
