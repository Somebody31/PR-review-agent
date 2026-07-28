import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrContext } from "@pr-review/github";
import type { Finding } from "@pr-review/shared";
import { runReviewGraph } from "./graph.js";
import { runSpecialistAgent } from "./run-agent.js";

vi.mock("./run-agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-agent.js")>();
  return {
    ...actual,
    runSpecialistAgent: vi.fn(),
  };
});

const mockedRunSpecialist = vi.mocked(runSpecialistAgent);

const emptyContext: PrContext = {
  owner: "acme",
  repo: "api",
  prNumber: 1,
  title: "t",
  body: "",
  headSha: "h",
  baseSha: "b",
  files: [{ path: "a.ts", status: "modified", patch: "+x" }],
};

function makeFinding(agentType: Finding["agentType"]): Finding {
  // Unique category/line so dedupe keeps all four specialists
  const lineStart =
    agentType === "security" ? 1 : agentType === "quality" ? 2 : agentType === "tests" ? 3 : 4;
  return {
    agentType,
    severity: "LOW",
    category: `${agentType}-note`,
    summary: `${agentType} note`,
    filePath: "a.ts",
    lineStart,
    confidence: 0.8,
    rationale: "test",
  };
}

describe("runReviewGraph", () => {
  beforeEach(() => {
    mockedRunSpecialist.mockReset();
  });

  it("merges four specialists and returns agent timings", async () => {
    mockedRunSpecialist.mockImplementation(async (args) => {
      return {
        findings: [makeFinding(args.agentType)],
        latencyMs: 12,
      };
    });

    const output = await runReviewGraph({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      prContext: emptyContext,
      llm: { apiKey: "k", baseUrl: "https://x", model: "m" },
      autoPostEnabled: false,
      hitlThreshold: 0.75,
    });

    expect(output.result.findings.length).toBe(4);
    expect(output.agentTimings).toHaveLength(4);
    expect(output.agentTimings.join(" ")).toMatch(/security:/);
    expect(output.agentTimings.join(" ")).toMatch(/quality:/);
    expect(output.agentTimings.join(" ")).toMatch(/tests:/);
    expect(output.agentTimings.join(" ")).toMatch(/docs:/);
    expect(output.result.outcome).toBe("hitl_queue");
  });

  it("continues when one specialist fails", async () => {
    mockedRunSpecialist.mockImplementation(async (args) => {
      if (args.agentType === "docs") {
        throw new Error("docs boom");
      }
      return {
        findings: [makeFinding(args.agentType)],
        latencyMs: 5,
      };
    });

    const output = await runReviewGraph({
      reviewId: "r1",
      owner: "acme",
      repo: "api",
      prNumber: 1,
      prContext: emptyContext,
      llm: { apiKey: "k", baseUrl: "https://x", model: "m" },
      autoPostEnabled: true,
      hitlThreshold: 0.5,
    });

    expect(output.result.findings.length).toBe(3);
    expect(output.agentTimings.some((t) => t.includes("docs:error"))).toBe(true);
    expect(output.result.summaryMarkdown).toMatch(/docs boom|Agent errors/i);
  });
});
