import { describe, expect, it } from "vitest";
import {
  formatConfidence,
  formatPrLabel,
  formatUsd,
  shortSha,
} from "./format";

describe("shortSha", () => {
  it("takes first 7 chars", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
  });

  it("handles empty", () => {
    expect(shortSha(null)).toBe("—");
  });
});

describe("formatConfidence", () => {
  it("formats ratio as percent", () => {
    expect(formatConfidence(0.75)).toBe("75%");
  });

  it("handles missing", () => {
    expect(formatConfidence(null)).toBe("—");
  });
});

describe("formatUsd", () => {
  it("formats numbers", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
  });

  it("formats numeric strings", () => {
    expect(formatUsd("1.5")).toBe("$1.5000");
  });
});

describe("formatPrLabel", () => {
  it("builds owner/repo#n", () => {
    expect(formatPrLabel("acme", "app", 12)).toBe("acme/app#12");
  });
});
