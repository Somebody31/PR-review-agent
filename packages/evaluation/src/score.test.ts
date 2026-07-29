import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures.js";
import { runEval } from "./run-eval.js";
import {
  aggregateScores,
  DEFAULT_MIN_PRECISION,
  DEFAULT_MIN_RECALL,
  scoreCategories,
  scoreFixture,
} from "./score.js";

describe("scoreCategories", () => {
  it("scores perfect match", () => {
    const m = scoreCategories(["injection"], ["injection"]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.truePositives).toBe(1);
  });

  it("penalizes false positives and negatives", () => {
    const m = scoreCategories(["injection", "secret-leak"], ["injection", "noise"]);
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(1);
    expect(m.falseNegatives).toBe(1);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.5);
  });
});

describe("golden fixtures", () => {
  it("has at least 5 fixtures", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(5);
  });

  it("each fixture has expected categories and files", () => {
    for (const fixture of FIXTURES) {
      expect(fixture.id.length).toBeGreaterThan(0);
      expect(fixture.files.length).toBeGreaterThan(0);
      expect(fixture.expectedCategories.length).toBeGreaterThan(0);
    }
  });

  it("offline detectors pass default thresholds", () => {
    const report = runEval();
    expect(report.passed).toBe(true);
    expect(report.overall.precision).toBeGreaterThanOrEqual(DEFAULT_MIN_PRECISION);
    expect(report.overall.recall).toBeGreaterThanOrEqual(DEFAULT_MIN_RECALL);
  });

  it("aggregateScores micro-averages fixture results", () => {
    const scores = FIXTURES.map((f) => scoreFixture(f));
    const overall = aggregateScores(scores);
    expect(overall.truePositives).toBeGreaterThan(0);
    expect(overall.recall).toBeGreaterThan(0);
  });
});
