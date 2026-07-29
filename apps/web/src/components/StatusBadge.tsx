import type { ReactElement } from "react";

/**
 * Map review / HITL status strings to a small colored badge.
 */
export function StatusBadge(props: {
  value: string | null | undefined;
}): ReactElement {
  const raw = props.value ?? "unknown";
  const lower = raw.toLowerCase();
  let kind = "badge-info";
  if (
    lower === "completed" ||
    lower === "approved" ||
    lower === "auto_post" ||
    lower === "posted"
  ) {
    kind = "badge-ok";
  } else if (
    lower === "hitl_pending" ||
    lower === "pending" ||
    lower === "hitl_queue" ||
    lower === "critical_escalate" ||
    lower === "running"
  ) {
    kind = "badge-warn";
  } else if (
    lower === "failed" ||
    lower === "rejected" ||
    lower === "hitl_rejected"
  ) {
    kind = "badge-danger";
  }

  return <span className={`badge ${kind}`}>{raw}</span>;
}

/** Severity badge for findings. */
export function SeverityBadge(props: {
  value: string;
}): ReactElement {
  const upper = props.value.toUpperCase();
  let kind = "badge-info";
  if (upper === "CRITICAL" || upper === "HIGH") {
    kind = "badge-danger";
  } else if (upper === "MEDIUM") {
    kind = "badge-warn";
  } else if (upper === "LOW" || upper === "INFO") {
    kind = "badge-ok";
  }
  return <span className={`badge ${kind}`}>{upper}</span>;
}
