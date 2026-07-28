import { describe, expect, it } from "vitest";
import { getPrompt } from "./prompts.js";

describe("getPrompt", () => {
  it("returns security v1 prompt", () => {
    const prompt = getPrompt("security", "v1");
    expect(prompt).toContain("security");
  });

  it("throws on missing version", () => {
    expect(() => getPrompt("security", "v99")).toThrow(/Unknown prompt version/);
  });
});
