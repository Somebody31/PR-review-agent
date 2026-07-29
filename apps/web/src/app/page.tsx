import type { ReactElement } from "react";
import Link from "next/link";
import { ApiErrorBox, formatLoadError } from "@/components/ApiErrorBox";
import { StatusBadge } from "@/components/StatusBadge";
import { listReviews } from "@/lib/api";
import {
  formatConfidence,
  formatPrLabel,
  formatUsd,
  formatWhen,
  shortSha,
} from "@/lib/format";

export default async function ReviewsPage(): Promise<ReactElement> {
  let reviews;
  try {
    reviews = await listReviews(50);
  } catch (error: unknown) {
    return (
      <>
        <h1>Reviews</h1>
        <p className="lead">Recent PR review runs from the API.</p>
        <ApiErrorBox message={formatLoadError(error)} context="reviews" />
      </>
    );
  }

  return (
    <>
      <h1>Reviews</h1>
      <p className="lead">
        Recent PR review runs. Open a row for findings, cost, and the event
        timeline.
      </p>

      {reviews.length === 0 ? (
        <div className="empty">
          No reviews yet. Trigger a GitHub webhook or enqueue a job against a
          running API + worker.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PR</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>Confidence</th>
                <th>Cost</th>
                <th>Head</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => (
                <tr key={review.id}>
                  <td>
                    <Link href={`/reviews/${review.id}`}>
                      {formatPrLabel(review.owner, review.repo, review.prNumber)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={review.status} />
                  </td>
                  <td>
                    <StatusBadge value={review.outcome} />
                  </td>
                  <td>{formatConfidence(review.overallConfidence)}</td>
                  <td className="mono">{formatUsd(review.costUsd)}</td>
                  <td className="mono">{shortSha(review.headSha)}</td>
                  <td>{formatWhen(review.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
