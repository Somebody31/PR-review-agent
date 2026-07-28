import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { PrContext } from "@pr-review/github";
import type { AgentType, Finding, ReviewResult } from "@pr-review/shared";
import { aggregateFindings } from "./aggregate.js";
import type { LlmConfig } from "./run-agent.js";
import { runSpecialistAgent } from "./run-agent.js";

/**
 * LangGraph state for one PR review run.
 * findings / agentErrors use append reducers so parallel specialists can merge.
 */
const ReviewState = Annotation.Root({
  reviewId: Annotation<string>,
  owner: Annotation<string>,
  repo: Annotation<string>,
  prNumber: Annotation<number>,
  prContext: Annotation<PrContext>,
  llm: Annotation<LlmConfig>,
  autoPostEnabled: Annotation<boolean>,
  hitlThreshold: Annotation<number>,
  findings: Annotation<Finding[]>({
    reducer: (left: Finding[], right: Finding[]) => left.concat(right),
    default: () => [],
  }),
  agentErrors: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => left.concat(right),
    default: () => [],
  }),
  agentTimings: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => left.concat(right),
    default: () => [],
  }),
  result: Annotation<ReviewResult | null>({
    reducer: (_left: ReviewResult | null, right: ReviewResult | null) => right,
    default: () => null,
  }),
});

export type ReviewGraphState = typeof ReviewState.State;

/** Compiled LangGraph that runs specialists then aggregate. */
export type CompiledReviewGraph = {
  invoke: (input: ReviewGraphState) => Promise<ReviewGraphState>;
};

/**
 * Build the review graph: four specialists in parallel, then aggregate.
 */
export function buildReviewGraph(): CompiledReviewGraph {
  const graph = new StateGraph(ReviewState)
    .addNode("security", (state: ReviewGraphState) => specialistNode("security", state))
    .addNode("quality", (state: ReviewGraphState) => specialistNode("quality", state))
    .addNode("tests", (state: ReviewGraphState) => specialistNode("tests", state))
    .addNode("docs", (state: ReviewGraphState) => specialistNode("docs", state))
    .addNode("aggregate", aggregateNode)
    .addEdge(START, "security")
    .addEdge(START, "quality")
    .addEdge(START, "tests")
    .addEdge(START, "docs")
    .addEdge("security", "aggregate")
    .addEdge("quality", "aggregate")
    .addEdge("tests", "aggregate")
    .addEdge("docs", "aggregate")
    .addEdge("aggregate", END);

  const compiled = graph.compile();
  return {
    invoke: async (input: ReviewGraphState): Promise<ReviewGraphState> => {
      const output = await compiled.invoke(input);
      return output as ReviewGraphState;
    },
  };
}

async function specialistNode(
  agentType: AgentType,
  state: ReviewGraphState,
): Promise<Partial<ReviewGraphState>> {
  try {
    const result = await runSpecialistAgent({
      agentType,
      prContext: state.prContext,
      llm: state.llm,
    });
    return {
      findings: result.findings,
      agentTimings: [`${agentType}:${result.latencyMs}ms`],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agentErrors: [`${agentType}: ${message}`],
      agentTimings: [`${agentType}:error`],
    };
  }
}

function aggregateNode(state: ReviewGraphState): Partial<ReviewGraphState> {
  const result = aggregateFindings({
    reviewId: state.reviewId,
    owner: state.owner,
    repo: state.repo,
    prNumber: state.prNumber,
    findings: state.findings,
    agentErrors: state.agentErrors,
    autoPostEnabled: state.autoPostEnabled,
    hitlThreshold: state.hitlThreshold,
  });
  return { result };
}

/**
 * Run the full review graph for one PR.
 */
export async function runReviewGraph(input: {
  reviewId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prContext: PrContext;
  llm: LlmConfig;
  autoPostEnabled: boolean;
  hitlThreshold: number;
}): Promise<{ result: ReviewResult; agentTimings: string[] }> {
  const graph = buildReviewGraph();
  const finalState = await graph.invoke({
    reviewId: input.reviewId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    prContext: input.prContext,
    llm: input.llm,
    autoPostEnabled: input.autoPostEnabled,
    hitlThreshold: input.hitlThreshold,
    findings: [],
    agentErrors: [],
    agentTimings: [],
    result: null,
  });

  if (!finalState.result) {
    throw new Error("review graph finished without a result");
  }
  return {
    result: finalState.result,
    agentTimings: finalState.agentTimings,
  };
}
