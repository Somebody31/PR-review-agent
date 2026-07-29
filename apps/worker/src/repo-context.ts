/**
 * RAG index + retrieve for a PR. Soft-fails to empty string so review continues.
 */
import { createLogger, maskSecrets } from "@pr-review/core";
import type { Database } from "@pr-review/db";
import {
  buildRetrievalQuery,
  formatRetrievedContext,
  indexChangedFiles,
  retrieveContext,
  type EmbedConfig,
} from "@pr-review/memory";

const logger = createLogger({ name: "worker-rag" });

/**
 * Index/retrieve RAG context for the PR. Soft-fails to "" so review can continue.
 */
export async function loadRepoContext(args: {
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
