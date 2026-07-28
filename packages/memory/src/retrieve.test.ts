import { describe, expect, it } from "vitest";
import {
  buildRetrievalQuery,
  formatRetrievedContext,
  mapDistanceRows,
} from "./retrieve.js";

describe("buildRetrievalQuery", () => {
  it("includes title and paths", () => {
    const q = buildRetrievalQuery("Add auth", ["src/a.ts", "src/b.ts"]);
    expect(q).toContain("Add auth");
    expect(q).toContain("src/a.ts");
  });
});

describe("formatRetrievedContext", () => {
  it("returns empty string for no chunks", () => {
    expect(formatRetrievedContext([])).toBe("");
  });

  it("formats path and content", () => {
    const text = formatRetrievedContext([
      { path: "src/a.ts", content: "export const x = 1;", score: 0.9 },
    ]);
    expect(text).toContain("src/a.ts");
    expect(text).toContain("export const x");
  });
});

describe("mapDistanceRows", () => {
  it("maps path content and distance to score", () => {
    const chunks = mapDistanceRows([
      { path: "a.ts", content: "x", distance: 0 },
      { path: "b.ts", content: "y", distance: "1" },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.score).toBe(1);
    expect(chunks[1]?.path).toBe("b.ts");
  });
});

