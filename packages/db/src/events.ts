import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { agentEvents } from "./schema.js";

/**
 * Only llm_call rows store billable USD. agent_end / review_end must not
 * set costUsd, or BudgetGuard and economics would double/triple-count.
 */
export const BILLABLE_EVENT_TYPE = "llm_call";

/** Input for one append-only agent_events row. */
export type AgentEventInput = {
  reviewId?: string | null;
  agent?: string | null;
  spanId?: string | null;
  parentSpan?: string | null;
  eventType: string;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** USD cost; stored as numeric string in Postgres. */
  costUsd?: number | string | null;
  latencyMs?: number | null;
  outcome?: string | null;
  confidence?: number | null;
  payload?: unknown;
};

/** Row shape returned when listing events. */
export type AgentEventRow = {
  id: string;
  ts: Date;
  reviewId: string | null;
  agent: string | null;
  spanId: string | null;
  parentSpan: string | null;
  eventType: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  outcome: string | null;
  confidence: number | null;
  payload: unknown;
};

/**
 * Append one agent_events row. Returns the new row id.
 */
export async function emitAgentEvent(
  db: Database,
  input: AgentEventInput,
): Promise<string> {
  const costUsd =
    input.costUsd === undefined || input.costUsd === null
      ? null
      : String(input.costUsd);

  const rows = await db
    .insert(agentEvents)
    .values({
      reviewId: input.reviewId ?? null,
      agent: input.agent ?? null,
      spanId: input.spanId ?? null,
      parentSpan: input.parentSpan ?? null,
      eventType: input.eventType,
      model: input.model ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      costUsd,
      latencyMs: input.latencyMs ?? null,
      outcome: input.outcome ?? null,
      confidence: input.confidence ?? null,
      payload: input.payload ?? null,
    })
    .returning({ id: agentEvents.id });

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("failed to insert agent_events row");
  }
  return id;
}

/**
 * List events for a review oldest-first (timeline order).
 */
export async function listEventsForReview(
  db: Database,
  reviewId: string,
): Promise<AgentEventRow[]> {
  const rows = await db
    .select({
      id: agentEvents.id,
      ts: agentEvents.ts,
      reviewId: agentEvents.reviewId,
      agent: agentEvents.agent,
      spanId: agentEvents.spanId,
      parentSpan: agentEvents.parentSpan,
      eventType: agentEvents.eventType,
      model: agentEvents.model,
      tokensIn: agentEvents.tokensIn,
      tokensOut: agentEvents.tokensOut,
      costUsd: agentEvents.costUsd,
      latencyMs: agentEvents.latencyMs,
      outcome: agentEvents.outcome,
      confidence: agentEvents.confidence,
      payload: agentEvents.payload,
    })
    .from(agentEvents)
    .where(eq(agentEvents.reviewId, reviewId))
    .orderBy(asc(agentEvents.ts));

  return rows;
}

/**
 * Event count + billable cost for one review (SQL aggregate; no full timeline load).
 */
export async function eventsSummaryForReview(
  db: Database,
  reviewId: string,
): Promise<{ eventCount: number; costUsd: number }> {
  const rows = await db
    .select({
      eventCount: sql<string>`count(*)::text`,
      costUsd: sql<string>`coalesce(sum(case when ${agentEvents.eventType} = ${BILLABLE_EVENT_TYPE} then ${agentEvents.costUsd} else 0 end), 0)`,
    })
    .from(agentEvents)
    .where(eq(agentEvents.reviewId, reviewId));

  const eventCount = Number(rows[0]?.eventCount ?? 0) || 0;
  const costUsd = Number(rows[0]?.costUsd ?? 0) || 0;
  return { eventCount, costUsd };
}

/**
 * UTC midnight bounds for the calendar day containing `now`.
 */
export function utcDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Sum billable cost_usd (llm_call only) for the current UTC calendar day.
 * Used by BudgetGuard before LLM calls.
 */
export async function sumCostUsdUtcDay(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const { start, end } = utcDayBounds(now);

  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(${agentEvents.costUsd}), 0)`,
    })
    .from(agentEvents)
    .where(
      and(
        gte(agentEvents.ts, start),
        lt(agentEvents.ts, end),
        eq(agentEvents.eventType, BILLABLE_EVENT_TYPE),
      ),
    );

  const raw = rows[0]?.total ?? "0";
  const value = Number(raw);
  if (Number.isNaN(value)) {
    return 0;
  }
  return value;
}

/**
 * Cost rollups for the economics REST endpoint (llm_call billable rows only).
 */
export async function economicsSummary(
  db: Database,
): Promise<{
  totalCostUsd: number;
  byAgent: Array<{ agent: string; costUsd: number }>;
  byDay: Array<{ day: string; costUsd: number }>;
}> {
  const billable = eq(agentEvents.eventType, BILLABLE_EVENT_TYPE);

  const totalRows = await db
    .select({
      total: sql<string>`coalesce(sum(${agentEvents.costUsd}), 0)`,
    })
    .from(agentEvents)
    .where(billable);

  const byAgentRows = await db
    .select({
      agent: sql<string>`coalesce(${agentEvents.agent}, 'unknown')`,
      costUsd: sql<string>`coalesce(sum(${agentEvents.costUsd}), 0)`,
    })
    .from(agentEvents)
    .where(billable)
    .groupBy(sql`coalesce(${agentEvents.agent}, 'unknown')`)
    .orderBy(desc(sql`sum(${agentEvents.costUsd})`));

  const byDayRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${agentEvents.ts} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      costUsd: sql<string>`coalesce(sum(${agentEvents.costUsd}), 0)`,
    })
    .from(agentEvents)
    .where(billable)
    .groupBy(sql`date_trunc('day', ${agentEvents.ts} AT TIME ZONE 'UTC')`)
    .orderBy(desc(sql`date_trunc('day', ${agentEvents.ts} AT TIME ZONE 'UTC')`));

  const byAgent: Array<{ agent: string; costUsd: number }> = [];
  for (const row of byAgentRows) {
    byAgent.push({
      agent: row.agent,
      costUsd: Number(row.costUsd) || 0,
    });
  }

  const byDay: Array<{ day: string; costUsd: number }> = [];
  for (const row of byDayRows) {
    byDay.push({
      day: row.day,
      costUsd: Number(row.costUsd) || 0,
    });
  }

  return {
    totalCostUsd: Number(totalRows[0]?.total ?? 0) || 0,
    byAgent,
    byDay,
  };
}
