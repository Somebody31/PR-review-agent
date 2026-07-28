import { Queue, type ConnectionOptions } from "bullmq";
import type { ReviewJob } from "@pr-review/shared";

export const REVIEW_QUEUE_NAME = "review.pr";

/** BullMQ queue for PR review jobs (used by API enqueue + worker). */
export type ReviewQueue = Queue<ReviewJob>;

/**
 * Build a BullMQ connection config from REDIS_URL.
 */
export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
}

/**
 * Create the review job queue (API process).
 */
export function createReviewQueue(redisUrl: string): ReviewQueue {
  return new Queue<ReviewJob>(REVIEW_QUEUE_NAME, {
    connection: redisConnectionFromUrl(redisUrl),
  });
}

/**
 * Stable job id so the same delivery is not processed twice.
 */
export function reviewJobId(job: ReviewJob): string {
  return `delivery:${job.deliveryId}`;
}
