/**
 * Server-only client for the Hono REST API.
 * Token stays on the server — never ship API_AUTH_TOKEN to the browser.
 */
import "server-only";

import { createApiError } from "./api-error";
import type {
  AgentEvent,
  EconomicsSummary,
  EventsSummary,
  HitlListItem,
  ReviewDetail,
  ReviewListItem,
} from "./types";

function apiBaseUrl(): string {
  const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  return base.replace(/\/$/, "");
}

function apiAuthToken(): string {
  return process.env.API_AUTH_TOKEN ?? "";
}

/**
 * Low-level JSON fetch with Bearer auth.
 * Only call from Server Components / Server Actions.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = apiAuthToken();
  if (!token) {
    throw createApiError(
      503,
      "API_AUTH_TOKEN is not set for the web app (server env)",
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers,
    // Dashboard should see fresh ops data
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // keep default message
    }
    throw createApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listReviews(limit: number = 50): Promise<ReviewListItem[]> {
  const data = await apiFetch<{ reviews: ReviewListItem[] }>(
    `/api/reviews?limit=${limit}`,
  );
  return data.reviews;
}

export async function getReview(
  id: string,
): Promise<{ review: ReviewDetail; eventsSummary: EventsSummary }> {
  return apiFetch(`/api/reviews/${encodeURIComponent(id)}`);
}

export async function listReviewEvents(id: string): Promise<AgentEvent[]> {
  const data = await apiFetch<{ reviewId: string; events: AgentEvent[] }>(
    `/api/reviews/${encodeURIComponent(id)}/events`,
  );
  return data.events;
}

export async function getEconomics(): Promise<EconomicsSummary> {
  return apiFetch("/api/economics/summary");
}

export async function listHitl(limit: number = 50): Promise<HitlListItem[]> {
  const data = await apiFetch<{ items: HitlListItem[] }>(
    `/api/hitl?limit=${limit}`,
  );
  return data.items;
}

export async function approveHitl(hitlId: string): Promise<unknown> {
  return apiFetch(`/api/hitl/${encodeURIComponent(hitlId)}/approve`, {
    method: "POST",
    body: "{}",
  });
}

export async function rejectHitl(
  hitlId: string,
  comment?: string,
): Promise<unknown> {
  return apiFetch(`/api/hitl/${encodeURIComponent(hitlId)}/reject`, {
    method: "POST",
    body: JSON.stringify(comment ? { comment } : {}),
  });
}

export async function disputeFinding(
  findingId: string,
  comment?: string,
): Promise<unknown> {
  return apiFetch(`/api/findings/${encodeURIComponent(findingId)}/dispute`, {
    method: "POST",
    body: JSON.stringify(comment ? { comment } : {}),
  });
}
