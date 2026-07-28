import { describe, expect, it } from "vitest";
import {
  createBudgetExceededError,
  DEFAULT_LLM_ESTIMATE_USD,
  isBudgetExceededError,
  isOverBudget,
} from "./budget.js";

describe("isOverBudget", () => {
  it("allows when spent + estimate is within cap", () => {
    expect(isOverBudget(1, 0.5, 20)).toBe(false);
  });

  it("blocks when spent + estimate exceeds cap", () => {
    expect(isOverBudget(19.5, 1, 20)).toBe(true);
  });

  it("blocks when budget is 0 and estimate is positive", () => {
    expect(isOverBudget(0, DEFAULT_LLM_ESTIMATE_USD, 0)).toBe(true);
  });

  it("allows equality at the cap boundary (strict >)", () => {
    expect(isOverBudget(10, 10, 20)).toBe(false);
  });
});

describe("createBudgetExceededError / isBudgetExceededError", () => {
  it("builds a named error with spent/estimate/cap fields", () => {
    const error = createBudgetExceededError(5, 1, 5);
    expect(error.name).toBe("BudgetExceededError");
    expect(error.spentUsd).toBe(5);
    expect(error.estimateUsd).toBe(1);
    expect(error.dailyBudgetUsd).toBe(5);
    expect(error.message).toMatch(/Daily budget exceeded/);
    expect(isBudgetExceededError(error)).toBe(true);
  });

  it("rejects ordinary errors", () => {
    expect(isBudgetExceededError(new Error("nope"))).toBe(false);
    expect(isBudgetExceededError(null)).toBe(false);
  });
});
