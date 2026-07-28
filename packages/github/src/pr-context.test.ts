import { describe, expect, it } from "vitest";
import {
  decodeGithubFileContent,
  fetchPrContext,
  mapGithubFiles,
  type PullsOctokit,
} from "./pr-context.js";

describe("mapGithubFiles", () => {
  it("maps filename status and optional patch", () => {
    const files = mapGithubFiles([
      { filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@" },
      { filename: "src/b.ts", status: "added" },
    ]);

    expect(files).toEqual([
      { path: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@" },
      { path: "src/b.ts", status: "added" },
    ]);
  });
});

describe("decodeGithubFileContent", () => {
  it("decodes base64 to utf8", () => {
    const encoded = Buffer.from("hello world", "utf8").toString("base64");
    expect(decodeGithubFileContent(encoded)).toBe("hello world");
  });
});

describe("fetchPrContext", () => {
  it("builds PrContext from mocked Octokit responses", async () => {
    const contentBase64 = Buffer.from("export const x = 1;\n", "utf8").toString("base64");

    const octokit: PullsOctokit = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              title: "Add feature",
              body: "Details",
              head: { sha: "headsha" },
              base: { sha: "basesha" },
            },
          }),
          listFiles: async () => ({
            data: [
              {
                filename: "src/a.ts",
                status: "modified",
                patch: "@@ -1 +1 @@\n+export const x = 1;",
              },
              {
                filename: "src/gone.ts",
                status: "removed",
                patch: "@@ -1 +0 @@\n-old",
              },
            ],
          }),
        },
        repos: {
          getContent: async () => ({
            data: {
              type: "file",
              content: contentBase64,
              encoding: "base64",
            },
          }),
        },
      },
    };

    const context = await fetchPrContext(octokit, {
      owner: "acme",
      repo: "api",
      prNumber: 42,
    });

    expect(context.owner).toBe("acme");
    expect(context.repo).toBe("api");
    expect(context.prNumber).toBe(42);
    expect(context.title).toBe("Add feature");
    expect(context.body).toBe("Details");
    expect(context.headSha).toBe("headsha");
    expect(context.baseSha).toBe("basesha");
    expect(context.files).toHaveLength(2);
    expect(context.files[0]?.path).toBe("src/a.ts");
    expect(context.files[0]?.content).toContain("export const x");
    // Removed files should not load content
    expect(context.files[1]?.content).toBeUndefined();
  });
});
