import type { ReactElement } from "react";
import { isApiError } from "@/lib/api-error";

/**
 * Format a caught load error into a plain string for UI.
 * Do not pass Error objects as Server Component props — React Flight
 * debug serialization crashes with "chunk.reason.enqueueModel is not a function".
 */
export function formatLoadError(error: unknown): string {
  if (isApiError(error)) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Show a friendly error when the REST API is down or misconfigured. */
export function ApiErrorBox(props: {
  /** Pre-formatted message — never pass an Error instance here. */
  message: string;
  context: string;
}): ReactElement {
  return (
    <div className="flash flash-error" role="alert">
      <strong>Could not load {props.context}.</strong>
      <div>{props.message}</div>
      <div className="lead" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
        Check that the API is running and <code>API_BASE_URL</code> /{" "}
        <code>API_AUTH_TOKEN</code> match the API process.
      </div>
    </div>
  );
}
