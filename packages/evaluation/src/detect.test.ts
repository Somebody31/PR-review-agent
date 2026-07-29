import { describe, expect, it } from "vitest";
import { detectCategories } from "./detect.js";
import { FIXTURES } from "./fixtures.js";
import type { EvalFixture } from "./types.js";

function fixtureById(id: string): EvalFixture {
  const found = FIXTURES.find((f) => f.id === id);
  if (!found) {
    throw new Error(`missing fixture ${id}`);
  }
  return found;
}

describe("detectCategories", () => {
  it("finds SQL injection", () => {
    expect(detectCategories(fixtureById("sql-injection"))).toContain("injection");
  });

  it("finds hardcoded secret", () => {
    expect(detectCategories(fixtureById("hardcoded-secret"))).toContain("secret-leak");
  });

  it("finds missing test", () => {
    expect(detectCategories(fixtureById("missing-test"))).toContain("missing-test");
  });

  it("finds empty catch", () => {
    expect(detectCategories(fixtureById("empty-catch"))).toContain("empty-catch");
  });

  it("finds docs gap", () => {
    expect(detectCategories(fixtureById("docs-gap"))).toContain("docs-gap");
  });

  it("finds path traversal", () => {
    expect(detectCategories(fixtureById("path-traversal"))).toContain("path-traversal");
  });
});
