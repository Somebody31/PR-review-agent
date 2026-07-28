import { describe, expect, it } from "vitest";
import { findingSchema } from "./finding.js";

describe("findingSchema", () => {
  it("accepts a valid finding", () => {
    const result = findingSchema.safeParse({
      agentType: "security",
      severity: "HIGH",
      category: "injection",
      summary: "SQL built with string concat",
      filePath: "src/db.ts",
      lineStart: 42,
      confidence: 0.9,
      rationale: "User input is concatenated into SQL.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects confidence greater than 1", () => {
    const result = findingSchema.safeParse({
      agentType: "security",
      severity: "HIGH",
      category: "injection",
      summary: "Bad confidence",
      filePath: "src/db.ts",
      lineStart: 1,
      // Invalid: confidence must be 0..1
      confidence: 2,
      rationale: "Test invalid confidence.",
    });

    expect(result.success).toBe(false);
  });
});
