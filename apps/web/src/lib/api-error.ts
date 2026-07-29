/**
 * Plain API error shape (ADR-010: no Error class hierarchy).
 * Safe to import from UI components — no env / fetch here.
 */

export type ApiError = Error & {
  name: "ApiError";
  status: number;
};

export function createApiError(status: number, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.name = "ApiError";
  error.status = status;
  return error;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    error.name === "ApiError" &&
    typeof (error as ApiError).status === "number"
  );
}
