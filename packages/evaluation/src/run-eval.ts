import { FIXTURES } from "./fixtures.js";
import { checkPromptContracts } from "./prompt-contract.js";
import {
  aggregateScores,
  DEFAULT_MIN_PRECISION,
  DEFAULT_MIN_RECALL,
  scoreFixture,
} from "./score.js";
import type { EvalReport } from "./types.js";

/**
 * Run golden-set evaluation and exit non-zero when below thresholds.
 * Offline: fixture detectors + prompt contract checks — no LLM calls.
 */
export function runEval(options?: {
  minPrecision?: number;
  minRecall?: number;
}): EvalReport {
  const minPrecision = options?.minPrecision ?? DEFAULT_MIN_PRECISION;
  const minRecall = options?.minRecall ?? DEFAULT_MIN_RECALL;

  const fixtures = FIXTURES.map((fixture) => scoreFixture(fixture));
  const overall = aggregateScores(fixtures);
  const passed =
    overall.precision >= minPrecision && overall.recall >= minRecall;

  return {
    fixtures,
    overall,
    passed,
    minPrecision,
    minRecall,
  };
}

function main(): void {
  const promptCheck = checkPromptContracts();
  console.log("PR Review Agent — golden eval");
  console.log("prompt contracts:");
  if (promptCheck.ok) {
    console.log("  ok");
  } else {
    for (const failure of promptCheck.failures) {
      console.error(`  FAIL ${failure}`);
    }
  }

  const report = runEval();

  console.log(`fixtures: ${report.fixtures.length}`);
  for (const row of report.fixtures) {
    const status =
      row.metrics.falseNegatives === 0 && row.metrics.falsePositives === 0
        ? "ok"
        : "gap";
    console.log(
      `  [${status}] ${row.fixtureId}: expected=[${row.expected.join(",")}] predicted=[${row.predicted.join(",")}] P=${row.metrics.precision.toFixed(2)} R=${row.metrics.recall.toFixed(2)}`,
    );
  }
  console.log(
    `overall: precision=${report.overall.precision.toFixed(3)} recall=${report.overall.recall.toFixed(3)} (min P=${report.minPrecision} R=${report.minRecall})`,
  );

  if (!promptCheck.ok) {
    console.error("EVAL FAILED: prompt contract check failed");
    process.exit(1);
  }

  if (!report.passed) {
    console.error("EVAL FAILED: below precision/recall threshold");
    process.exit(1);
  }

  console.log("EVAL PASSED");
}

// Run when executed as CLI (tsx src/run-eval.ts)
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("run-eval.ts") ||
    process.argv[1].endsWith("run-eval.js"));

if (isMain) {
  main();
}
