/** Shapes returned by the Hono REST API (JSON). Dates arrive as ISO strings. */

export type ReviewListItem = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  status: string;
  overallConfidence: number | null;
  outcome: string | null;
  costUsd: string | null;
  githubReviewId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FindingListItem = {
  id: string;
  agentType: string;
  severity: string;
  category: string;
  summary: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  suggestion: string | null;
  confidence: number;
  rationale: string;
};

export type ReviewDetail = ReviewListItem & {
  baseSha: string | null;
  summaryMarkdown: string | null;
  errorMessage: string | null;
  findings: FindingListItem[];
};

export type EventsSummary = {
  eventCount: number;
  /** Billable llm_call cost for this review only. */
  costUsd: number;
};

export type AgentEvent = {
  id: string;
  reviewId: string;
  eventType: string;
  agent: string | null;
  spanId: string | null;
  parentSpan: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  outcome: string | null;
  confidence: number | null;
  payload: unknown;
  ts: string;
};

export type HitlListItem = {
  id: string;
  reviewId: string;
  state: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
};

export type EconomicsSummary = {
  totalCostUsd: number;
  byAgent: Array<{ agent: string; costUsd: number }>;
  byDay: Array<{ day: string; costUsd: number }>;
};
