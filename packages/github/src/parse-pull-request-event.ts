import type { ReviewJob } from "@pr-review/shared";

export type ParsedPullRequestEvent = {
  shouldReview: boolean;
  job: ReviewJob | null;
  reason: string;
};

type GithubPullRequestPayload = {
  action?: string;
  number?: number;
  installation?: { id?: number };
  pull_request?: {
    number?: number;
    head?: { sha?: string };
    base?: { sha?: string };
  };
  repository?: {
    name?: string;
    owner?: { login?: string };
  };
};

/**
 * Turn a GitHub pull_request webhook JSON object into a ReviewJob when actionable.
 */
export function parsePullRequestEvent(
  deliveryId: string,
  payload: unknown,
): ParsedPullRequestEvent {
  const body = payload as GithubPullRequestPayload;
  const action = body.action ?? "";
  const allowed = action === "opened" || action === "synchronize" || action === "reopened";

  if (!allowed) {
    return { shouldReview: false, job: null, reason: `ignored action: ${action}` };
  }

  const owner = body.repository?.owner?.login;
  const repo = body.repository?.name;
  const prNumber = body.pull_request?.number ?? body.number;
  const headSha = body.pull_request?.head?.sha;
  const baseSha = body.pull_request?.base?.sha;
  const installationId = body.installation?.id;

  if (!owner || !repo || !prNumber || !headSha || !baseSha || !installationId) {
    return { shouldReview: false, job: null, reason: "missing required PR fields" };
  }

  const job: ReviewJob = {
    deliveryId,
    installationId,
    owner,
    repo,
    prNumber,
    headSha,
    baseSha,
  };

  return { shouldReview: true, job, reason: "ok" };
}
