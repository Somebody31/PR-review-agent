/**
 * Conservative default estimate (USD) used before an LLM call when
 * exact token counts are unknown. Keeps DAILY_BUDGET_USD=0 blocking.
 */
export const DEFAULT_LLM_ESTIMATE_USD = 0.01;

/**
 * Error shape when spent + estimate would exceed the daily LLM budget.
 * Plain Error + fields (ADR-010: no class hierarchy).
 */
export type BudgetExceededError = Error & {
  spentUsd: number;
  estimateUsd: number;
  dailyBudgetUsd: number;
};

/**
 * Build a BudgetExceededError for hard-stop paths (worker checkBudget).
 */
export function createBudgetExceededError(
  spentUsd: number,
  estimateUsd: number,
  dailyBudgetUsd: number,
): BudgetExceededError {
  const error = new Error(
    `Daily budget exceeded: spent $${spentUsd.toFixed(4)} + estimate $${estimateUsd.toFixed(4)} > $${dailyBudgetUsd.toFixed(4)} UTC day cap`,
  ) as BudgetExceededError;
  error.name = "BudgetExceededError";
  error.spentUsd = spentUsd;
  error.estimateUsd = estimateUsd;
  error.dailyBudgetUsd = dailyBudgetUsd;
  return error;
}

/**
 * True when error is a BudgetExceededError from createBudgetExceededError.
 */
export function isBudgetExceededError(error: unknown): error is BudgetExceededError {
  if (!(error instanceof Error) || error.name !== "BudgetExceededError") {
    return false;
  }
  const candidate = error as BudgetExceededError;
  return (
    typeof candidate.spentUsd === "number" &&
    typeof candidate.estimateUsd === "number" &&
    typeof candidate.dailyBudgetUsd === "number"
  );
}

/**
 * True when adding estimate to spent would exceed the daily cap.
 */
export function isOverBudget(
  spentUsd: number,
  estimateUsd: number,
  dailyBudgetUsd: number,
): boolean {
  return spentUsd + estimateUsd > dailyBudgetUsd;
}
