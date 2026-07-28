import { runReviewGraph } from "@pr-review/agents";
import { createLogger, loadConfig } from "@pr-review/core";
import {
  failReview,
  finishReview,
  getDb,
  insertFindings,
  insertReviewRunning,
  statusForOutcome,
  type Database,
} from "@pr-review/db";
import {
  createGithubApp,
  fetchPrContext,
  getInstallationOctokit,
} from "@pr-review/github";
import {
  buildRetrievalQuery,
  formatRetrievedContext,
  indexChangedFiles,
  retrieveContext,
  type EmbedConfig,
} from "@pr-review/memory";
import type { ReviewJob } from "@pr-review/shared";

const logger = createLogger({ name: "worker" });

/**
 * Load PR context, index/retrieve RAG context, run LangGraph, persist findings.
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
    logger.warn(
      { reviewId: args.reviewId, err: message },
      "RAG skipped; continuing with diff only",
    );
    return "";
  }
}
