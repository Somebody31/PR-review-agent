import { describe, expect, it } from "vitest";
import { hashContent } from "./hash.js";

describe("hashContent", () => {
  it("is stable for the same content", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });

  it("changes when content changes", () => {
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});
