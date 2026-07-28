import { z } from "zod";

/** Which specialist agent produced a finding. */
export const agentTypeSchema = z.enum(["security", "quality", "tests", "docs"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

/** How severe a finding is for the reviewer. */
export const severitySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
export type Severity = z.infer<typeof severitySchema>;

/** What the system should do after aggregating findings. */
export const reviewOutcomeSchema = z.enum([
  "auto_post",
  "hitl_queue",
  "critical_escalate",
]);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;
