/** One synthetic PR file change used as an eval fixture. */
export type FixtureFile = {
  path: string;
  status: string;
  patch: string;
};

/**
 * Golden fixture: synthetic diff + categories a correct reviewer must surface.
 * Categories are coarse tags (injection, secret-leak, missing-test, …).
 */
export type EvalFixture = {
  id: string;
  title: string;
  body?: string;
  files: FixtureFile[];
  expectedCategories: string[];
};

/** Micro-averaged category match metrics. */
export type ScoreMetrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

export type FixtureScore = {
  fixtureId: string;
  expected: string[];
  predicted: string[];
  metrics: ScoreMetrics;
};

export type EvalReport = {
  fixtures: FixtureScore[];
  overall: ScoreMetrics;
  passed: boolean;
  minPrecision: number;
  minRecall: number;
};
