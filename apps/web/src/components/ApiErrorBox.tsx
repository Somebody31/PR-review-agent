import type { ReactElement } from "react";
import { isApiError } from "@/lib/api-error";

/** Show a friendly error when the REST API is down or misconfigured. */
export function ApiErrorBox(props: {
  error: unknown;
  context: string;
}): ReactElement {
  let message: string;
  if (isApiError(props.error)) {
    message = `${props.error.message} (HTTP ${props.error.status})`;
  } else if (props.error instanceof Error) {
    message = props.error.message;
  } else {
    message = String(props.error);
  }

  return (
    <div className="flash flash-error" role="alert">
      <strong>Could not load {props.context}.</strong>
      <div>{message}</div>
      <div className="lead" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
        Check that the API is running and <code>API_BASE_URL</code> /{" "}
        <code>API_AUTH_TOKEN</code> match the API process.
      </div>
    </div>
  );
}
