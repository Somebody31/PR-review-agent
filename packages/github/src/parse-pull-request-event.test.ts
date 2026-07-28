import { describe, expect, it } from "vitest";
import { parsePullRequestEvent } from "./parse-pull-request-event.js";

function validPayload(action: string): unknown {
  return {
    action,
    installation: { id: 99 },
    pull_request: {
      number: 7,
      head: { sha: "headsha" },
      base: { sha: "basesha" },
    },
    repository: {
      name: "repo",
      owner: { login: "owner" },
    },
  };
}

describe("parsePullRequestEvent", () => {
  it("builds a ReviewJob for opened", () => {
    const result = parsePullRequestEvent("del-1", validPayload("opened"));
    expect(result.shouldReview).toBe(true);
    expect(result.job).toEqual({
      deliveryId: "del-1",
      installationId: 99,
      owner: "owner",
      repo: "repo",
      prNumber: 7,
      headSha: "headsha",
      baseSha: "basesha",
    });
  });

  it("accepts synchronize and reopened", () => {
    expect(parsePullRequestEvent("d", validPayload("synchronize")).shouldReview).toBe(true);
    expect(parsePullRequestEvent("d", validPayload("reopened")).shouldReview).toBe(true);
  });

  it("ignores other actions", () => {
    const result = parsePullRequestEvent("d", validPayload("closed"));
    expect(result.shouldReview).toBe(false);
    expect(result.job).toBeNull();
  });

  it("rejects missing installation id", () => {
    const payload = validPayload("opened") as {
      installation?: { id?: number };
    };
    delete payload.installation;
    const result = parsePullRequestEvent("d", payload);
    expect(result.shouldReview).toBe(false);
  });
});
