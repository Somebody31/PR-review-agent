import type { ReactElement } from "react";
import Link from "next/link";
import { ApiErrorBox, formatLoadError } from "@/components/ApiErrorBox";
import { HitlActions } from "@/components/HitlActions";
import { StatusBadge } from "@/components/StatusBadge";
import { listHitl } from "@/lib/api";
import { formatPrLabel, formatWhen } from "@/lib/format";

export default async function HitlPage(): Promise<ReactElement> {
  let items;
  try {
    items = await listHitl(50);
  } catch (error: unknown) {
    return (
      <>
        <h1>HITL queue</h1>
        <p className="lead">
          Human-in-the-loop items waiting for approve (post) or reject.
        </p>
        <ApiErrorBox message={formatLoadError(error)} context="HITL queue" />
      </>
    );
  }

  return (
    <>
      <h1>HITL queue</h1>
      <p className="lead">
        Approve posts the GitHub review (claim-before-post). Reject closes
        without posting. Token stays on the server.
      </p>

      {items.length === 0 ? (
        <div className="empty">
          No HITL items. Low-confidence or CRITICAL runs appear here when the
          worker queues them.
        </div>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <article key={item.id} className="card">
              <div className="meta-row">
                <span>
                  <StatusBadge value={item.state} />
                </span>
                <span>
                  PR{" "}
                  <strong>
                    {formatPrLabel(item.owner, item.repo, item.prNumber)}
                  </strong>
                </span>
                <span>
                  Review{" "}
                  <Link href={`/reviews/${item.reviewId}`}>
                    <span className="mono">{item.reviewId.slice(0, 8)}…</span>
                  </Link>
                </span>
                <span>Created {formatWhen(item.createdAt)}</span>
              </div>
              <HitlActions hitlId={item.id} state={item.state} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
