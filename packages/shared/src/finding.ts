import { z } from "zod";
import { agentTypeSchema, severitySchema } from "./enums.js";

/**
 * One structured issue from a specialist agent.
 * Agents return Finding[], not free-form prose.
 */
export const findingSchema = z.object({
  agentType: agentTypeSchema,
  severity: severitySchema,
  /** Short machine-friendly tag, e.g. "injection" or "missing-test". */
  category: z.string().min(1),
  summary: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  /** Model confidence in this finding; must be between 0 and 1 inclusive. */
  confidence: z.number().min(0).max(1),
  /** Why this finding was raised — required for audit / disputes. */
  rationale: z.string().min(1),
});

export type Finding = z.infer<typeof findingSchema>;
