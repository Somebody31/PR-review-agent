import { z } from "zod";

/** Which specialist agent produced a finding. */
export const agentTypeSchema = z.enum(["security", "quality", "tests", "docs"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

/** How severe a finding is for the reviewer. */
export const severitySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
export type Severity = z.infer<typeof severitySchema>;

/**
 * Aggregator + terminal HITL outcomes written on pr_reviews.outcome.
 * Aggregator emits auto_post / hitl_queue / critical_escalate;
 * human reject finishes with hitl_rejected (typed for monitoring).
 */
export const reviewOutcomeSchema = z.enum([
  "auto_post",
  "hitl_queue",
  "critical_escalate",
  "hitl_rejected",
]);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;
