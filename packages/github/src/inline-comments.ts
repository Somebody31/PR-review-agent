/**
 * Map findings onto PR-diff lines for GitHub inline review comments.
 */
import type { Finding } from "@pr-review/shared";

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
