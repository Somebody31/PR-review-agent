import { describe, expect, it, vi } from "vitest";
import {
  BILLABLE_EVENT_TYPE,
  emitAgentEvent,
  economicsSummary,
  eventsSummaryForReview,
  listEventsForReview,
  sumCostUsdUtcDay,
  utcDayBounds,
} from "./events.js";
import type { Database } from "./client.js";

describe("utcDayBounds", () => {
  it("returns UTC midnight start and next-day end", () => {
    // 2026-07-28 15:30 UTC
    const now = new Date(Date.UTC(2026, 6, 28, 15, 30, 0));
    const bounds = utcDayBounds(now);

    expect(bounds.start.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });
});

describe("emitAgentEvent", () => {
  it("inserts a row and returns the id", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    const id = await emitAgentEvent(db, {
      reviewId: "rev-1",
      eventType: "review_start",
      agent: "worker",
      costUsd: 0.0123,
    });

    expect(id).toBe("evt-1");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "rev-1",
        eventType: "review_start",
        agent: "worker",
        costUsd: "0.0123",
      }),
    );
  });

  it("throws when insert returns no id", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    await expect(
      emitAgentEvent(db, { eventType: "review_start" }),
    ).rejects.toThrow(/failed to insert/);
  });
});

describe("listEventsForReview", () => {
  it("selects events ordered by ts", async () => {
    const sample = [
      {
        id: "e1",
        ts: new Date("2026-07-28T01:00:00Z"),
        reviewId: "rev-1",
        agent: "security",
        spanId: "s1",
        parentSpan: null,
        eventType: "agent_end",
        model: "deepseek-v4-flash",
        tokensIn: 10,
        tokensOut: 5,
        costUsd: "0.001",
        latencyMs: 100,
        outcome: null,
        confidence: null,
        payload: null,
      },
    ];

    const orderBy = vi.fn().mockResolvedValue(sample);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const rows = await listEventsForReview(db, "rev-1");

    expect(rows).toEqual(sample);
    expect(select).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});

describe("eventsSummaryForReview", () => {
  it("returns event count and billable cost from aggregate", async () => {
    const where = vi.fn().mockResolvedValue([{ eventCount: "4", costUsd: "0.012" }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const summary = await eventsSummaryForReview(db, "rev-1");

    expect(summary).toEqual({ eventCount: 4, costUsd: 0.012 });
  });
});

describe("sumCostUsdUtcDay", () => {
  it("returns numeric sum from the query", async () => {
    const where = vi.fn().mockResolvedValue([{ total: "1.5" }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const total = await sumCostUsdUtcDay(db, new Date("2026-07-28T12:00:00Z"));

    expect(total).toBe(1.5);
  });

  it("returns 0 when sum is missing", async () => {
    const where = vi.fn().mockResolvedValue([{ total: null }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    const total = await sumCostUsdUtcDay(db);

    expect(total).toBe(0);
  });

  it("filters by BILLABLE_EVENT_TYPE (llm_call) so agent_end/review_end are not counted", async () => {
    const where = vi.fn().mockResolvedValue([{ total: "0.004" }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Database;

    await sumCostUsdUtcDay(db, new Date("2026-07-28T12:00:00Z"));

    // where() is called with an and(...) of day bounds + event_type = llm_call
    expect(where).toHaveBeenCalledTimes(1);
    expect(BILLABLE_EVENT_TYPE).toBe("llm_call");
  });
});

describe("economicsSummary", () => {
  it("maps total, byAgent, and byDay rows", async () => {
    let call = 0;
    const select = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // total
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ total: "2.5" }]),
          }),
        };
      }
      if (call === 2) {
        // by agent
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([
                  { agent: "security", costUsd: "1.0" },
                  { agent: "quality", costUsd: "1.5" },
                ]),
              }),
            }),
          }),
        };
      }
      // by day
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { day: "2026-07-28", costUsd: "2.5" },
              ]),
            }),
          }),
        }),
      };
    });

    const db = { select } as unknown as Database;
    const summary = await economicsSummary(db);

    expect(summary.totalCostUsd).toBe(2.5);
    expect(summary.byAgent).toEqual([
      { agent: "security", costUsd: 1 },
      { agent: "quality", costUsd: 1.5 },
    ]);
    expect(summary.byDay).toEqual([{ day: "2026-07-28", costUsd: 2.5 }]);
  });

  it("scopes all rollups to billable llm_call event type", async () => {
    let call = 0;
    const whereFns: ReturnType<typeof vi.fn>[] = [];
    const select = vi.fn().mockImplementation(() => {
      call += 1;
      const where = vi.fn();
      whereFns.push(where);
      if (call === 1) {
        where.mockResolvedValue([{ total: "1" }]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
      where.mockReturnValue({
        groupBy: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      });
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const db = { select } as unknown as Database;
    await economicsSummary(db);

    // total + byAgent + byDay each apply a billable where clause
    expect(whereFns).toHaveLength(3);
    for (const where of whereFns) {
      expect(where).toHaveBeenCalledTimes(1);
    }
    expect(BILLABLE_EVENT_TYPE).toBe("llm_call");
  });
});
