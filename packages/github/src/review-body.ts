/**
 * Pure helpers that turn findings into the GitHub review body markdown.
 */
import type { Finding } from "@pr-review/shared";

/** GitHub pull request review event. */
export type GithubReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

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
