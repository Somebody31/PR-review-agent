import { createLogger } from "@pr-review/core";
import type { ReviewJob } from "@pr-review/shared";

const logger = createLogger({ name: "worker" });

/**
 * Phase 2: log and complete. Later phases run LangGraph here.
 */
export async function handleReviewJob(job: ReviewJob): Promise<void> {
  logger.info(
    {
      deliveryId: job.deliveryId,
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      headSha: job.headSha,
    },
    "processing review job",
  );
}
