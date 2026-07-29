import type { ReactElement } from "react";
import Link from "next/link";
import { ApiErrorBox, formatLoadError } from "@/components/ApiErrorBox";
import { StatusBadge } from "@/components/StatusBadge";
import { listReviewEvents } from "@/lib/api";
import { formatConfidence, formatUsd, formatWhen } from "@/lib/format";

export default async function TracePage(props: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await props.params;

  let events;
  try {
    events = await listReviewEvents(id);
  } catch (error: unknown) {
    return (
      <>
        <h1>Event timeline</h1>
        <ApiErrorBox
          message={formatLoadError(error)}
          context="event timeline"
        />
        <p>
          <Link href={`/reviews/${id}`}>← Back to review</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <p>
        <Link href={`/reviews/${id}`}>← Review</Link>
      </p>
      <h1>Event timeline</h1>
      <p className="lead">
        agent_events for review <span className="mono">{id}</span> (newest first
        if API returns that order).
      </p>

      {events.length === 0 ? (
        <div className="empty">No events recorded for this review.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Agent</th>
                <th>Outcome</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Latency</th>
                <th>Conf</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatWhen(event.ts)}</td>
                  <td className="mono">{event.eventType}</td>
                  <td>{event.agent ?? "—"}</td>
                  <td>
                    <StatusBadge value={event.outcome} />
                  </td>
                  <td className="mono">{event.model ?? "—"}</td>
                  <td className="mono">
                    {event.tokensIn ?? "—"}/{event.tokensOut ?? "—"}
                  </td>
                  <td className="mono">{formatUsd(event.costUsd)}</td>
                  <td className="mono">
                    {event.latencyMs !== null && event.latencyMs !== undefined
                      ? `${event.latencyMs}ms`
                      : "—"}
                  </td>
                  <td>{formatConfidence(event.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
