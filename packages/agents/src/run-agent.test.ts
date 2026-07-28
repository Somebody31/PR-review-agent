import { describe, expect, it, vi } from "vitest";
import type { PrContext } from "@pr-review/github";
import { buildUserMessage, runSpecialistAgent } from "./run-agent.js";

const sqlFixtureContext: PrContext = {
  owner: "acme",
  repo: "api",
  prNumber: 7,
  title: "Add user lookup",
  body: "quick fix",
  headSha: "abc",
  baseSha: "def",
  files: [
    {
      path: "src/users.ts",
      status: "modified",
      patch: [
        "@@ -10,3 +10,6 @@",
        " export function findUser(id: string) {",
        '-  return db.query("SELECT * FROM users WHERE id = $1", [id]);',
        '+  // intentional SQL string concat for fixture',
        '+  return db.query("SELECT * FROM users WHERE id = \'" + id + "\'");',
        " }",
      ].join("\n"),
    },
  ],
};

describe("buildUserMessage", () => {
  it("includes path and patch from the PR", () => {
    const message = buildUserMessage(sqlFixtureContext);
    expect(message).toContain("src/users.ts");
    expect(message).toContain("SELECT * FROM users");
  });

  it("appends repository context when provided", () => {
    const message = buildUserMessage(sqlFixtureContext, "### helpers.ts\n```\nexport const x = 1;\n```");
    expect(message).toContain("# Repository context");
    expect(message).toContain("helpers.ts");
  });
});

describe("runSpecialistAgent", () => {
  it("returns security findings with filePath for a SQL-concat fixture", async () => {
    const findingJson = [
      {
        agentType: "security",
        severity: "HIGH",
        category: "injection",
        summary: "SQL string concatenation",
        filePath: "src/users.ts",
        lineStart: 12,
        confidence: 0.91,
        rationale: "User id is concatenated into SQL",
      },
    ];

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(findingJson) } }],
          usage: { prompt_tokens: 20, completion_tokens: 30 },
        }),
        { status: 200 },
      );
    });

    const result = await runSpecialistAgent({
      agentType: "security",
      prContext: sqlFixtureContext,
      llm: {
        apiKey: "test",
        baseUrl: "https://example.test/v1",
        model: "deepseek-v4-flash",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0]?.filePath).toBe("src/users.ts");
    expect(result.findings[0]?.agentType).toBe("security");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
