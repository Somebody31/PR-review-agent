import { z } from "zod";

/**
 * Minimal payload enqueued after a verified GitHub webhook.
 * Worker uses this to load PR context and run the LangGraph review.
 */
export const reviewJobSchema = z.object({
  deliveryId: z.string().min(1),
  installationId: z.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  baseSha: z.string().min(1),
});

export type ReviewJob = z.infer<typeof reviewJobSchema>;
