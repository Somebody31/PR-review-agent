import { describe, expect, it } from "vitest";
import type { Finding } from "@pr-review/shared";
import {
  aggregateFindings,
  chooseOutcome,
  dedupeFindings,
} from "./aggregate.js";

function finding(partial: Partial<Finding> & Pick<Finding, "summary">): Finding {
  return {
    agentType: partial.agentType ?? "security",
    severity: partial.severity ?? "MEDIUM",
    category: partial.category ?? "injection",
    summary: partial.summary,
    filePath: partial.filePath ?? "src/a.ts",
    lineStart: partial.lineStart ?? 10,
    confidence: partial.confidence ?? 0.8,
    rationale: partial.rationale ?? "because",
  };
}

describe("dedupeFindings", () => {
  it("keeps the highest confidence duplicate", () => {
    const result = dedupeFindings([
      finding({ summary: "low", confidence: 0.4 }),
      finding({ summary: "high", confidence: 0.9 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.summary).toBe("high");
  });
});

describe("chooseOutcome", () => {
  it("escalates CRITICAL", () => {
    const outcome = chooseOutcome({
      findings: [finding({ summary: "crit", severity: "CRITICAL" })],
      overallConfidence: 0.99,
      autoPostEnabled: true,
      hitlThreshold: 0.5,
      agentErrors: [],
    });
    expect(outcome).toBe("critical_escalate");
  });

  it("queues HITL when auto-post is disabled", () => {
    const outcome = chooseOutcome({
      findings: [finding({ summary: "x" })],
      overallConfidence: 0.99,
      autoPostEnabled: false,
      hitlThreshold: 0.5,
      agentErrors: [],
    });
    expect(outcome).toBe("hitl_queue");
  });

  it("queues HITL when confidence is below threshold", () => {
    const outcome = chooseOutcome({
      findings: [finding({ summary: "x", confidence: 0.2 })],
      overallConfidence: 0.2,
      autoPostEnabled: true,
      hitlThreshold: 0.75,
      agentErrors: [],
    });
    expect(outcome).toBe("hitl_queue");
  });
});

describe("aggregateFindings", () => {
  it("returns a review result with summary", () => {
    const result = aggregateFindings({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      findings: [finding({ summary: "issue" })],
      agentErrors: [],
      autoPostEnabled: false,
      hitlThreshold: 0.75,
    });
    expect(result.repo).toBe("acme/api");
    expect(result.findings).toHaveLength(1);
    expect(result.summaryMarkdown).toContain("issue");
    expect(result.outcome).toBe("hitl_queue");
  });

  it("lowers confidence when some agents fail", () => {
    const clean = aggregateFindings({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      findings: [finding({ summary: "x", confidence: 0.9 })],
      agentErrors: [],
      autoPostEnabled: true,
      hitlThreshold: 0.5,
    });
    const partial = aggregateFindings({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      findings: [finding({ summary: "x", confidence: 0.9 })],
      agentErrors: ["docs: timeout"],
      autoPostEnabled: true,
      hitlThreshold: 0.5,
    });
    expect(partial.overallConfidence).toBeLessThan(clean.overallConfidence);
  });

  it("forces hitl_queue when three or more agents fail", () => {
    const result = aggregateFindings({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      findings: [finding({ summary: "x", confidence: 0.99 })],
      agentErrors: ["a: fail", "b: fail", "c: fail"],
      autoPostEnabled: true,
      hitlThreshold: 0.1,
    });
    expect(result.outcome).toBe("hitl_queue");
  });
});
