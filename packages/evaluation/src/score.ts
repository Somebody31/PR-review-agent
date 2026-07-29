import type { EvalFixture, FixtureScore, ScoreMetrics } from "./types.js";
import { detectCategories } from "./detect.js";

/**
 * Multiset category precision / recall for one fixture.
 * Each expected category counts once; extras are false positives.
 */
export function scoreCategories(
  expected: string[],
  predicted: string[],
): ScoreMetrics {
  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);

  let truePositives = 0;
  for (const cat of predictedSet) {
    if (expectedSet.has(cat)) {
      truePositives += 1;
    }
  }

  const falsePositives = predictedSet.size - truePositives;
  const falseNegatives = expectedSet.size - truePositives;

  const precision =
    predictedSet.size === 0 ? 1 : truePositives / predictedSet.size;
  const recall = expectedSet.size === 0 ? 1 : truePositives / expectedSet.size;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
  };
}

/**
 * Score one fixture with the offline detector.
 */
export function scoreFixture(fixture: EvalFixture): FixtureScore {
  const predicted = detectCategories(fixture);
  return {
    fixtureId: fixture.id,
    expected: fixture.expectedCategories,
    predicted,
    metrics: scoreCategories(fixture.expectedCategories, predicted),
  };
}

/**
 * Micro-average TP/FP/FN across fixtures, then precision/recall.
 */
export function aggregateScores(scores: FixtureScore[]): ScoreMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const score of scores) {
    truePositives += score.metrics.truePositives;
    falsePositives += score.metrics.falsePositives;
    falseNegatives += score.metrics.falseNegatives;
  }

  const predictedCount = truePositives + falsePositives;
  const expectedCount = truePositives + falseNegatives;
  const precision = predictedCount === 0 ? 1 : truePositives / predictedCount;
  const recall = expectedCount === 0 ? 1 : truePositives / expectedCount;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
  };
}

/** Default gates: high recall on known issues; allow some FP slack. */
export const DEFAULT_MIN_PRECISION = 0.7;
export const DEFAULT_MIN_RECALL = 0.8;
