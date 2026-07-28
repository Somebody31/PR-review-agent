import type { Finding, ReviewOutcome, ReviewResult } from "@pr-review/shared";

/**
 * Merge specialist findings: dedup, score confidence, choose outcome.
 */
export function aggregateFindings(args: {
  reviewId: string;
  owner: string;
  repo: string;
  prNumber: number;
  findings: Finding[];
  agentErrors: string[];
  autoPostEnabled: boolean;
  hitlThreshold: number;
}): ReviewResult {
  const deduped = sortFindingsBySeverity(dedupeFindings(args.findings));
  const overallConfidence = computeOverallConfidence(deduped, args.agentErrors);
  const outcome = chooseOutcome({
    findings: deduped,
    overallConfidence,
    autoPostEnabled: args.autoPostEnabled,
    hitlThreshold: args.hitlThreshold,
    agentErrors: args.agentErrors,
  });

  const summaryMarkdown = buildSummaryMarkdown(deduped, outcome, args.agentErrors);

  return {
    reviewId: args.reviewId,
    prNumber: args.prNumber,
    repo: `${args.owner}/${args.repo}`,
    findings: deduped,
    overallConfidence,
    outcome,
    summaryMarkdown,
  };
}

/**
 * Keep highest-confidence finding per filePath + lineStart + category.
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const bestByKey = new Map<string, Finding>();

  for (const finding of findings) {
    const key = `${finding.filePath}|${finding.lineStart}|${finding.category}`;
    const existing = bestByKey.get(key);
    if (!existing || finding.confidence > existing.confidence) {
      bestByKey.set(key, finding);
    }
  }

  const result: Finding[] = [];
  for (const finding of bestByKey.values()) {
    result.push(finding);
  }
  return result;
}

/**
 * Sort findings by severity (highest first), then file path.
 */
export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  const sorted = findings.slice();
  sorted.sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return a.filePath.localeCompare(b.filePath);
  });
  return sorted;
}

/**
 * Average finding confidence; drop when specialists failed.
 * No findings + no errors → high confidence "clean" review.
 */
export function computeOverallConfidence(
  findings: Finding[],
  agentErrors: string[],
): number {
  if (agentErrors.length > 0) {
    // Each failed agent lowers trust in the merged result
    const penalty = Math.min(0.4, agentErrors.length * 0.1);
    if (findings.length === 0) {
      return Math.max(0, 0.5 - penalty);
    }
    const avg = averageConfidence(findings);
    return Math.max(0, avg - penalty);
  }

  if (findings.length === 0) {
    return 0.9;
  }
  return averageConfidence(findings);
}

export function chooseOutcome(args: {
  findings: Finding[];
  overallConfidence: number;
  autoPostEnabled: boolean;
  hitlThreshold: number;
  agentErrors: string[];
}): ReviewOutcome {
  let hasCritical = false;
  for (const finding of args.findings) {
    if (finding.severity === "CRITICAL") {
      hasCritical = true;
      break;
    }
  }

  if (hasCritical) {
    return "critical_escalate";
  }

  // Four specialists: three failures means fewer than two successes → force human review
  if (args.agentErrors.length >= 3) {
    return "hitl_queue";
  }

  if (!args.autoPostEnabled) {
    return "hitl_queue";
  }

  if (args.overallConfidence < args.hitlThreshold) {
    return "hitl_queue";
  }

  return "auto_post";
}

function averageConfidence(findings: Finding[]): number {
  let sum = 0;
  for (const finding of findings) {
    sum += finding.confidence;
  }
  return sum / findings.length;
}

function severityRank(severity: Finding["severity"]): number {
  if (severity === "CRITICAL") return 5;
  if (severity === "HIGH") return 4;
  if (severity === "MEDIUM") return 3;
  if (severity === "LOW") return 2;
  return 1;
}

function buildSummaryMarkdown(
  findings: Finding[],
  outcome: ReviewOutcome,
  agentErrors: string[],
): string {
  const lines: string[] = [];
  lines.push(`## AI PR review`);
  lines.push("");
  lines.push(`**Outcome:** \`${outcome}\``);
  lines.push(`**Findings:** ${findings.length}`);
  if (agentErrors.length > 0) {
    lines.push(`**Agent errors:** ${agentErrors.join("; ")}`);
  }
  lines.push("");

  if (findings.length === 0) {
    lines.push("_No selective findings._");
    return lines.join("\n");
  }

  for (const finding of findings) {
    lines.push(
      `- **[${finding.severity}]** \`${finding.filePath}:${finding.lineStart}\` — ${finding.summary} _(confidence ${finding.confidence.toFixed(2)}, ${finding.agentType})_`,
    );
  }
  return lines.join("\n");
}
