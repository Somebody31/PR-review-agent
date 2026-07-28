import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./unique-violation.js";

describe("isUniqueViolation", () => {
  it("detects code 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects nested cause code 23505", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isUniqueViolation({ code: "57014" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});
