import { describe, expect, it } from "vitest";
import { chunkTextByLines } from "./chunk.js";

describe("chunkTextByLines", () => {
  it("splits with overlap", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 150; i += 1) {
      lines.push(`line-${i}`);
    }
    const text = lines.join("\n");
    const chunks = chunkTextByLines(text, 100, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.content.split("\n")).toHaveLength(100);
    // Second window starts at step 80 (line-81)
    expect(chunks[1]?.content.split("\n")[0]).toBe("line-81");
  });

  it("returns one empty chunk for empty file", () => {
    const chunks = chunkTextByLines("");
    expect(chunks).toEqual([{ chunkIndex: 0, content: "" }]);
  });
});
