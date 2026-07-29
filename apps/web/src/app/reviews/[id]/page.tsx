import type { ReactElement } from "react";
import Link from "next/link";
import { ApiErrorBox, formatLoadError } from "@/components/ApiErrorBox";
import { DisputeForm } from "@/components/DisputeForm";
import { SeverityBadge, StatusBadge } from "@/components/StatusBadge";
import { getReview } from "@/lib/api";
import {
  formatConfidence,
  formatPrLabel,
  formatUsd,
  formatWhen,
  shortSha,
} from "@/lib/format";

export default async function ReviewDetailPage(props: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await props.params;

  let data;
  try {
    data = await getReview(id);
  } catch (error: unknown) {
    return (
      <>
        <h1>Review</h1>
        <ApiErrorBox message={formatLoadError(error)} context="review detail" />
        <p>
          <Link href="/">← Back to reviews</Link>
        </p>
      </>
    );
  }

  const { review, eventsSummary } = data;
  const title = formatPrLabel(review.owner, review.repo, review.prNumber);

  return (
    <>
      <p>
        <Link href="/">← Reviews</Link>
      </p>
      <h1>{title}</h1>
      <p className="lead">
        Review <span className="mono">{review.id}</span>
      </p>

      <div className="page-actions">
        <Link className="btn" href={`/reviews/${review.id}/trace`}>
          Event timeline
        </Link>
      </div>

      <div className="card">
        <div className="meta-row">
          <span>
            Status <StatusBadge value={review.status} />
          </span>
          <span>
            Outcome <StatusBadge value={review.outcome} />
          </span>
          <span>
            Confidence <strong>{formatConfidence(review.overallConfidence)}</strong>
          </span>
          <span>
            Cost <strong>{formatUsd(review.costUsd)}</strong>
          </span>
          <span>
            Events <strong>{eventsSummary.eventCount}</strong>
          </span>
          <span>
            Billable (events) <strong>{formatUsd(eventsSummary.costUsd)}</strong>
          </span>
        </div>
        <div className="meta-row">
          <span>
            Head <span className="mono">{shortSha(review.headSha)}</span>
          </span>
          <span>
            Base <span className="mono">{shortSha(review.baseSha)}</span>
          </span>
          <span>
            GitHub review <span className="mono">{review.githubReviewId ?? "—"}</span>
          </span>
          <span>Created {formatWhen(review.createdAt)}</span>
          <span>Updated {formatWhen(review.updatedAt)}</span>
        </div>
        {review.errorMessage ? (
          <div className="flash flash-error">{review.errorMessage}</div>
        ) : null}
      </div>

      <h2>Summary</h2>
      {review.summaryMarkdown ? (
        <pre className="markdown-block">{review.summaryMarkdown}</pre>
      ) : (
        <div className="empty">No summary markdown stored.</div>
      )}

      <h2>Findings ({review.findings.length})</h2>
      {review.findings.length === 0 ? (
        <div className="empty">No findings for this review.</div>
      ) : (
        <div className="stack">
          {review.findings.map((finding) => (
            <article key={finding.id} className="card">
              <p className="finding-summary">{finding.summary}</p>
              <div className="finding-meta">
                <SeverityBadge value={finding.severity} />{" "}
                <span className="badge">{finding.agentType}</span>{" "}
                <span className="badge">{finding.category}</span>{" "}
                <span className="mono">
                  {finding.filePath}:{finding.lineStart}
                  {finding.lineEnd !== null && finding.lineEnd !== undefined
                    ? `–${finding.lineEnd}`
                    : ""}
                </span>{" "}
                · conf {formatConfidence(finding.confidence)}
              </div>
              <div className="finding-body">{finding.rationale}</div>
              {finding.suggestion ? (
                <div className="finding-body" style={{ marginTop: "0.4rem" }}>
                  <strong>Suggestion:</strong> {finding.suggestion}
                </div>
              ) : null}
              <DisputeForm findingId={finding.id} reviewId={review.id} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
