import type { ReactElement } from "react";
import { ApiErrorBox } from "@/components/ApiErrorBox";
import { getEconomics } from "@/lib/api";
import { formatUsd } from "@/lib/format";

export default async function EconomicsPage(): Promise<ReactElement> {
  let summary;
  try {
    summary = await getEconomics();
  } catch (error: unknown) {
    return (
      <>
        <h1>Economics</h1>
        <p className="lead">Billable LLM spend (llm_call events only).</p>
        <ApiErrorBox error={error} context="economics" />
      </>
    );
  }

  return (
    <>
      <h1>Economics</h1>
      <p className="lead">
        Cost rollups from billable <code>llm_call</code> agent events only.
      </p>

      <div className="card">
        <div className="meta-row">
          <span>
            Total billable <strong>{formatUsd(summary.totalCostUsd)}</strong>
          </span>
        </div>
      </div>

      <h2>By agent</h2>
      {summary.byAgent.length === 0 ? (
        <div className="empty">No billable agent spend yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.byAgent.map((row) => (
                <tr key={row.agent}>
                  <td>{row.agent}</td>
                  <td className="mono">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>By day (UTC)</h2>
      {summary.byDay.length === 0 ? (
        <div className="empty">No daily spend yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.byDay.map((row) => (
                <tr key={row.day}>
                  <td className="mono">{row.day}</td>
                  <td className="mono">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
