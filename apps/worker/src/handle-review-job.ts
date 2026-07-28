import { runReviewGraph } from "@pr-review/agents";
import { createLogger, loadConfig } from "@pr-review/core";
import {
  failReview,
  finishReview,
  getDb,
  insertFindings,
  insertReviewRunning,
  statusForOutcome,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
} from "@pr-review/github";
import type { ReviewJob } from "@pr-review/shared";

const logger = createLogger({ name: "worker" });

/**
 * Load PR context, run LangGraph specialists + aggregate, persist findings.
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
    if (!config.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY is required to run review agents");
    }

    const app = createGithubApp(config.GITHUB_APP_ID, config.GITHUB_PRIVATE_KEY);
    const octokit = await getInstallationOctokit(app, job.installationId);
    const context = await fetchPrContext(octokit, {
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
    });

    logger.info(
      {
        reviewId,
        title: context.title,
        fileCount: context.files.length,
      },
      "PR context loaded",
    );

    const graphOutput = await runReviewGraph({
      reviewId,
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      prContext: context,
      llm: {
        apiKey: config.DEEPSEEK_API_KEY,
        baseUrl: config.DEEPSEEK_BASE_URL,
        model: config.LLM_MODEL,
      },
      autoPostEnabled: config.AUTO_POST_ENABLED,
      hitlThreshold: config.HITL_CONFIDENCE_THRESHOLD,
    });

    const result = graphOutput.result;
    logger.info({ reviewId, agentTimings: graphOutput.agentTimings }, "agent timings");

    await insertFindings(db, reviewId, result.findings);
    await finishReview(db, reviewId, {
      status: statusForOutcome(result.outcome),
      overallConfidence: result.overallConfidence,
      outcome: result.outcome,
      summaryMarkdown: result.summaryMarkdown,
    });

    logger.info(
      {
        reviewId,
        findingCount: result.findings.length,
        outcome: result.outcome,
        overallConfidence: result.overallConfidence,
      },
      "review completed",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await failReview(db, reviewId, message);
    logger.error({ reviewId, err: message }, "review failed");
    throw error;
  }
}
