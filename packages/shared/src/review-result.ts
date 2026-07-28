import { z } from "zod";
import { findingSchema } from "./finding.js";
import { reviewOutcomeSchema } from "./enums.js";

/**
 * Final merged result after all specialists and the aggregator run.
 */
export const reviewResultSchema = z.object({
  reviewId: z.string().min(1),
  prNumber: z.number().int().positive(),
  /** owner/name form, e.g. "acme/api". */
  repo: z.string().min(1),
  findings: z.array(findingSchema),
  overallConfidence: z.number().min(0).max(1),
  outcome: reviewOutcomeSchema,
  summaryMarkdown: z.string(),
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;
