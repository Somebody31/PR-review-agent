import type { Finding } from "@pr-review/shared";

/** GitHub pull request review event. */
export type GithubReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

/** One inline comment on a PR review (line must exist in the diff). */
export type InlineReviewComment = {
  path: string;
  line: number;
  body: string;
};

/** Minimal file shape needed to know which lines are in the PR diff. */
export type DiffFileForComments = {
  path: string;
  patch?: string;
};

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
 * REQUEST_CHANGES when any CRITICAL/HIGH finding exists; otherwise COMMENT.
 * We never APPROVE automatically — humans still own merge decisions.
 */
export function decideReviewEvent(findings: Finding[]): GithubReviewEvent {
  for (const finding of findings) {
    if (finding.severity === "CRITICAL" || finding.severity === "HIGH") {
      return "REQUEST_CHANGES";
    }
  }
  return "COMMENT";
}

/**
 * Keep outcome/counts/errors or free-form prose; drop titles and finding bullets.
 * Aggregate summaryMarkdown already lists findings — embedding it raw would
 * duplicate headers and every finding next to the severity-grouped section.
 */
export function toShortReviewIntro(summaryMarkdown: string): string {
  const raw = summaryMarkdown.trim();
  if (raw.length === 0) {
    return "";
  }

  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (kept.length > 0) {
        kept.push("");
      }
      continue;
    }
    // Titles come from buildReviewBody
    if (/^#{1,6}\s/.test(trimmed)) {
      continue;
    }
    // Finding list lives in the severity section only
    if (/^-\s+/.test(trimmed)) {
      continue;
    }
    if (
      trimmed === "_No selective findings._" ||
      trimmed === "_No findings._"
    ) {
      continue;
    }
    kept.push(trimmed);
  }

  const collapsed: string[] = [];
  for (const line of kept) {
    if (
      line === "" &&
      (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")
    ) {
      continue;
    }
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") {
    collapsed.pop();
  }
  return collapsed.join("\n");
}

/**
 * Build the review body: short intro plus findings grouped by severity once.
 * Inline findings are still listed so the body stands alone if comments fail.
 */
export function buildReviewBody(
  findings: Finding[],
  summaryMarkdown: string,
): string {
  const lines: string[] = [];
  lines.push("## AI PR Review");
  lines.push("");

  const shortIntro = toShortReviewIntro(summaryMarkdown);
  if (shortIntro.length > 0) {
    lines.push(shortIntro);
    lines.push("");
  }

  if (findings.length === 0) {
    lines.push("_No findings._");
    return lines.join("\n");
  }

  lines.push("### Findings");
  lines.push("");

  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
  for (const severity of order) {
    const group: Finding[] = [];
    for (const finding of findings) {
      if (finding.severity === severity) {
        group.push(finding);
      }
    }
    if (group.length === 0) {
      continue;
    }
    lines.push(`#### ${severity}`);
    for (const finding of group) {
      const location = `${finding.filePath}:${finding.lineStart}`;
      lines.push(
        `- **[${finding.agentType}]** ${finding.summary} (\`${location}\`, confidence ${finding.confidence.toFixed(2)})`,
      );
      if (finding.suggestion) {
        lines.push(`  - Suggestion: ${finding.suggestion}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Collect right-side (new-file) line numbers from a unified diff patch.
 * GitHub only accepts inline review comments on lines that appear in the PR diff.
 */
export function parsePatchRightLines(patch: string): Set<number> {
  const lines = new Set<number>();
  const patchLines = patch.split("\n");
  let rightLine = 0;
  let inHunk = false;

  for (const raw of patchLines) {
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      rightLine = Number(hunkMatch[1]);
      const rightCount = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      // Deletion-only hunks have zero new lines — nothing commentable on RIGHT
      inHunk = rightCount > 0;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
      continue;
    }

    if (raw.startsWith("-")) {
      // Removed line — only exists on LEFT side
      continue;
    }

    if (raw.startsWith("+") || raw.startsWith(" ")) {
      lines.add(rightLine);
      rightLine += 1;
      continue;
    }

    // Unexpected line (e.g. empty between hunks) — leave hunk mode alone
  }

  return lines;
}

/**
 * Map file path → set of right-side line numbers present in that file's PR patch.
 */
export function collectCommentableLines(
  files: DiffFileForComments[],
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();

  for (const file of files) {
    if (!file.patch) {
      continue;
    }
    map.set(file.path, parsePatchRightLines(file.patch));
  }

  return map;
}

/**
 * Map findings that have a file + line into GitHub inline review comments.
 * Only lines present in the PR diff are included — others stay body-only
 * (buildReviewBody always lists every finding).
 */
export function mapFindingsToInlineComments(
  findings: Finding[],
  commentableLines: Map<string, Set<number>>,
): InlineReviewComment[] {
  const comments: InlineReviewComment[] = [];

  for (const finding of findings) {
    if (!finding.filePath || finding.lineStart < 1) {
      continue;
    }

    const allowed = commentableLines.get(finding.filePath);
    if (!allowed || !allowed.has(finding.lineStart)) {
      continue;
    }

    const bodyParts: string[] = [];
    bodyParts.push(`**${finding.severity}** (${finding.agentType}): ${finding.summary}`);
    bodyParts.push("");
    bodyParts.push(finding.rationale);
    if (finding.suggestion) {
      bodyParts.push("");
      bodyParts.push(`Suggestion: ${finding.suggestion}`);
    }

    comments.push({
      path: finding.filePath,
      line: finding.lineStart,
      body: bodyParts.join("\n"),
    });
  }

  return comments;
}

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
  const comments = mapFindingsToInlineComments(input.findings, commentableLines);

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
