import { describe, expect, it } from "vitest";
import { checkPromptContracts } from "./prompt-contract.js";

describe("checkPromptContracts", () => {
  it("passes on current specialist prompts", () => {
    const result = checkPromptContracts();
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
