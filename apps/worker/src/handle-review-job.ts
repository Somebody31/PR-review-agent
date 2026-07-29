import {
  createBudgetExceededError,
  isBudgetExceededError,
  isOverBudget,
  runReviewGraph,
  type AgentHookEvent,
  type ReviewHooks,
} from "@pr-review/agents";
import { createLogger, loadConfig, maskSecrets, withRetry } from "@pr-review/core";
import {
  emitAgentEvent,
  failReview,
  findPostedReviewByHead,
  finishReview,
  getDb,
  insertFindings,
  insertHitlItem,
  insertReviewRunning,
  setGithubReviewId,
  statusForOutcome,
  sumCostUsdUtcDay,
  type Database,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
  postPullRequestReview,
  type PrFile,
  type ReviewsOctokit,
} from "@pr-review/github";
import {
  buildRetrievalQuery,
  formatRetrievedContext,
  indexChangedFiles,
  retrieveContext,
  type EmbedConfig,
} from "@pr-review/memory";
import type { ReviewJob, ReviewResult } from "@pr-review/shared";

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

/**
 * Wire agent hooks to DB: emit events + BudgetGuard daily spend check (UTC day).
 */
function buildReviewHooks(
  db: Database,
  reviewId: string,
  dailyBudgetUsd: number,
): ReviewHooks {
  return {
    onEvent: async (event: AgentHookEvent): Promise<void> => {
      await emitAgentEvent(db, {
        reviewId,
        eventType: event.eventType,
        agent: event.agent,
        spanId: event.spanId,
        parentSpan: event.parentSpan,
        model: event.model,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
        outcome: event.outcome,
        confidence: event.confidence,
        payload: event.payload,
      });
    },
    checkBudget: async (estimateUsd: number): Promise<void> => {
      const spentUsd = await sumCostUsdUtcDay(db);
      if (isOverBudget(spentUsd, estimateUsd, dailyBudgetUsd)) {
        await emitAgentEvent(db, {
          reviewId,
          eventType: "budget_block",
          agent: "budget",
          payload: {
            spentUsd,
            estimateUsd,
            dailyBudgetUsd,
          },
        });
        throw createBudgetExceededError(spentUsd, estimateUsd, dailyBudgetUsd);
      }
    },
  };
}

/**
 * Post a GitHub review only for auto_post outcomes.
 * Skips the API call when the same head SHA already has a stored github_review_id.
 */
async function maybePostGithubReview(args: {
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

/**
 * Index/retrieve RAG context for the PR. Soft-fails to "" so review can continue.
 */
async function loadRepoContext(args: {
  db: Database;
  repoKey: string;
  title: string;
  files: Array<{ path: string; status: string; content?: string }>;
  embed: EmbedConfig;
  reviewId: string;
}): Promise<string> {
  try {
    const indexStats = await indexChangedFiles({
      db: args.db,
      repoKey: args.repoKey,
      files: args.files,
      embed: args.embed,
    });
    logger.info({ reviewId: args.reviewId, ...indexStats }, "RAG index pass");

    const paths: string[] = [];
    for (const file of args.files) {
      paths.push(file.path);
    }
    const queryText = buildRetrievalQuery(args.title, paths);
    const chunks = await retrieveContext({
      db: args.db,
      repoKey: args.repoKey,
      queryText,
      embed: args.embed,
    });
    const formatted = formatRetrievedContext(chunks);
    logger.info(
      { reviewId: args.reviewId, retrievedChunks: chunks.length },
      "RAG retrieve pass",
    );
    return formatted;
  } catch (ragError: unknown) {
    const message = ragError instanceof Error ? ragError.message : String(ragError);
    const safeMessage = maskSecrets(message);
    logger.warn(
      { reviewId: args.reviewId, err: safeMessage },
      "RAG skipped; continuing with diff only",
    );
    return "";
  }
}
