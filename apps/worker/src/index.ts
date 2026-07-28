import { Worker, type Job } from "bullmq";
import {
  createLogger,
  loadConfig,
  REVIEW_QUEUE_NAME,
  redisConnectionFromUrl,
} from "@pr-review/core";
import type { ReviewJob } from "@pr-review/shared";
import { handleReviewJob } from "./handle-review-job.js";

const logger = createLogger({ name: "worker" });

function main(): void {
  const config = loadConfig();

  const worker = new Worker<ReviewJob>(
    REVIEW_QUEUE_NAME,
    async (bullJob: Job<ReviewJob>): Promise<void> => {
      await handleReviewJob(bullJob.data);
    },
    {
      connection: redisConnectionFromUrl(config.REDIS_URL),
      concurrency: 1,
    },
  );

  worker.on("completed", (job: Job<ReviewJob>): void => {
    logger.info({ jobId: job.id }, "job completed");
  });

  worker.on("failed", (job: Job<ReviewJob> | undefined, error: Error): void => {
    logger.error({ jobId: job?.id, err: error.message }, "job failed");
  });

  logger.info("worker listening for review jobs");
}

main();
