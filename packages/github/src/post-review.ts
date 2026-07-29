/**
 * Create a GitHub PR review (body + optional inline comments).
 * Body markdown and diff-line mapping live in review-body / inline-comments.
 */
import type { Finding } from "@pr-review/shared";
import {
  collectCommentableLines,
  mapFindingsToInlineComments,
  type DiffFileForComments,
  type InlineReviewComment,
} from "./inline-comments.js";
import {
  buildReviewBody,
  decideReviewEvent,
  type GithubReviewEvent,
} from "./review-body.js";

// Re-export pure helpers so existing imports from post-review keep working.
export {
  buildReviewBody,
  decideReviewEvent,
  toShortReviewIntro,
  type GithubReviewEvent,
} from "./review-body.js";
export {
  collectCommentableLines,
  mapFindingsToInlineComments,
  parsePatchRightLines,
  type DiffFileForComments,
  type InlineReviewComment,
} from "./inline-comments.js";

/** Minimal Octokit surface for creating a PR review (easy to mock). */
export type ReviewsOctokit = {
  rest: {
    pulls: {
      createReview: (args: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        body: string;
        event: GithubReviewEvent;
        comments?: Array<{ path: string; line: number; body: string }>;
      }) => Promise<{ data: { id: number } }>;
    };
  };
};

export type PostPullRequestReviewInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  findings: Finding[];
  summaryMarkdown: string;
  /** PR changed files with patches; used to keep inline comments on diff lines only. */
  files: DiffFileForComments[];
};


export type PostPullRequestReviewResult = {
  githubReviewId: string;
};

/**
 * Read HTTP status from common Octokit / fetch error shapes.
 */
function getErrorHttpStatus(error: unknown): number | undefined {
  if (error === null || error === undefined || typeof error !== "object") {
    return undefined;
  }

  const record = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };

  if (typeof record.status === "number") {
    return record.status;
  }
  if (typeof record.statusCode === "number") {
    return record.statusCode;
  }
  if (typeof record.response?.status === "number") {
    return record.response.status;
  }
  return undefined;
}

/**
 * Create a GitHub PR review with body + optional inline comments.
 * Body-only fallback is only for validation failures (422) on inline comments.
 * Retryable errors (5xx/429) rethrow so the worker's withRetry can retry the full post.
 */
export async function postPullRequestReview(
  octokit: ReviewsOctokit,
  input: PostPullRequestReviewInput,
): Promise<PostPullRequestReviewResult> {
  const body = buildReviewBody(input.findings, input.summaryMarkdown);
  const event = decideReviewEvent(input.findings);
  const commentableLines = collectCommentableLines(input.files);
  const comments: InlineReviewComment[] = mapFindingsToInlineComments(
    input.findings,
    commentableLines,
  );

  const baseArgs = {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
    commit_id: input.headSha,
    body,
    event,
  };

  if (comments.length === 0) {
    const response = await octokit.rest.pulls.createReview(baseArgs);
    return {
      githubReviewId: String(response.data.id),
    };
  }

  try {
    const response = await octokit.rest.pulls.createReview({
      ...baseArgs,
      comments,
    });
    return {
      githubReviewId: String(response.data.id),
    };
  } catch (error: unknown) {
    // 422 = GitHub rejected an inline comment line; body still lists every finding.
    // Do not swallow 5xx/429 here — body-only "success" would skip worker retries.
    const status = getErrorHttpStatus(error);
    if (status !== 422) {
      throw error;
    }
    const response = await octokit.rest.pulls.createReview(baseArgs);
    return {
      githubReviewId: String(response.data.id),
    };
  }
}
