/**
 * Main review job pipeline (create row → context → agents → post/HITL → finish).
 * Helpers: review-hooks, post-github, repo-context.
 */
import {
  isBudgetExceededError,
  runReviewGraph,
} from "@pr-review/agents";
import { createLogger, loadConfig, maskSecrets } from "@pr-review/core";
import {
  emitAgentEvent,
  failReview,
  finishReview,
  getDb,
  insertFindings,
  insertHitlItem,
  insertReviewRunning,
  statusForOutcome,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
} from "@pr-review/github";
import type { EmbedConfig } from "@pr-review/memory";
import type { ReviewJob } from "@pr-review/shared";
import { maybePostGithubReview } from "./post-github.js";
import { loadRepoContext } from "./repo-context.js";
import { buildReviewHooks } from "./review-hooks.js";

const logger = createLogger({ name: "worker" });

/**
 * Load PR context, index/retrieve RAG context, run LangGraph, persist findings.
 * Posts to GitHub only when outcome is auto_post (idempotent per head SHA).
 * Emits agent_events for timeline / cost / BudgetGuard.
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

  await emitAgentEvent(db, {
    reviewId,
    eventType: "review_start",
    agent: "worker",
    payload: {
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      headSha: job.headSha,
      deliveryId: job.deliveryId,
    },
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

    const repoKey = `${job.owner}/${job.repo}`;
    const embedConfig: EmbedConfig = {
      baseUrl: config.EMBEDDING_BASE_URL,
      apiKey: config.EMBEDDING_API_KEY,
      model: config.EMBEDDING_MODEL,
    };

    const repoContext = await loadRepoContext({
      db,
      repoKey,
      title: context.title,
      files: context.files,
      embed: embedConfig,
      reviewId,
    });

    const hooks = buildReviewHooks(db, reviewId, config.DAILY_BUDGET_USD);

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
      repoContext,
      autoPostEnabled: config.AUTO_POST_ENABLED,
      hitlThreshold: config.HITL_CONFIDENCE_THRESHOLD,
      hooks,
    });

    const result = graphOutput.result;
    logger.info({ reviewId, agentTimings: graphOutput.agentTimings }, "agent timings");

    await insertFindings(db, reviewId, result.findings);

    // Only post when aggregator chose auto_post (requires AUTO_POST_ENABLED + confidence)
    const githubReviewId = await maybePostGithubReview({
      db,
      octokit,
      job,
      result,
      reviewId,
      files: context.files,
    });

    // Human must approve/reject before post when gated
    if (
      result.outcome === "hitl_queue" ||
      result.outcome === "critical_escalate"
    ) {
      const hitlId = await insertHitlItem(db, reviewId);
      logger.info({ reviewId, hitlId, outcome: result.outcome }, "HITL item queued");
    }

    const costUsd =
      graphOutput.totalCostUsd > 0 ? String(graphOutput.totalCostUsd) : undefined;

    await finishReview(db, reviewId, {
      status: statusForOutcome(result.outcome),
      overallConfidence: result.overallConfidence,
      outcome: result.outcome,
      summaryMarkdown: result.summaryMarkdown,
      githubReviewId,
      costUsd,
    });

    // review_end must not set costUsd — billable spend is only on llm_call rows
    await emitAgentEvent(db, {
      reviewId,
      eventType: "review_end",
      agent: "worker",
      outcome: result.outcome,
      confidence: result.overallConfidence,
      payload: {
        findingCount: result.findings.length,
        githubReviewId: githubReviewId ?? null,
        totalCostUsd: graphOutput.totalCostUsd,
      },
    });

    logger.info(
      {
        reviewId,
        findingCount: result.findings.length,
        outcome: result.outcome,
        overallConfidence: result.overallConfidence,
        githubReviewId,
        totalCostUsd: graphOutput.totalCostUsd,
      },
      "review completed",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Mask before log / event payload so stack text cannot leak keys
    const safeMessage = maskSecrets(message);
    const isBudget = isBudgetExceededError(error);

    await failReview(db, reviewId, safeMessage);

    // budget_block is already emitted by checkBudget; always close the timeline with review_failed
    await emitAgentEvent(db, {
      reviewId,
      eventType: "review_failed",
      agent: "worker",
      outcome: "failed",
      payload: {
        error: safeMessage.slice(0, 500),
        budgetExceeded: isBudget,
        ...(isBudget
          ? {
              spentUsd: error.spentUsd,
              estimateUsd: error.estimateUsd,
              dailyBudgetUsd: error.dailyBudgetUsd,
            }
          : {}),
      },
    });

    logger.error({ reviewId, err: safeMessage, budget: isBudget }, "review failed");
    throw error;
  }
}
