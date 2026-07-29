/**
 * Agent hook wiring: persist agent_events and enforce daily BudgetGuard.
 */
import {
  createBudgetExceededError,
  isOverBudget,
  type AgentHookEvent,
  type ReviewHooks,
} from "@pr-review/agents";
import {
  emitAgentEvent,
  sumCostUsdUtcDay,
  type Database,
} from "@pr-review/db";

/**
 * Wire agent hooks to DB: emit events + BudgetGuard daily spend check (UTC day).
 */
export function buildReviewHooks(
  db: Database,
  reviewId: string,
  dailyBudgetUsd: number,
): ReviewHooks {
  return {
    onEvent: async (event: AgentHookEvent): Promise<void> => {
      await emitAgentEvent(db, {
        reviewId,
        eventType: event.eventType,
        agent: event.agent,
        spanId: event.spanId,
        parentSpan: event.parentSpan,
        model: event.model,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
        outcome: event.outcome,
        confidence: event.confidence,
        payload: event.payload,
      });
    },
    checkBudget: async (estimateUsd: number): Promise<void> => {
      const spentUsd = await sumCostUsdUtcDay(db);
      if (isOverBudget(spentUsd, estimateUsd, dailyBudgetUsd)) {
        await emitAgentEvent(db, {
          reviewId,
          eventType: "budget_block",
          agent: "budget",
          payload: {
            spentUsd,
            estimateUsd,
            dailyBudgetUsd,
          },
        });
        throw createBudgetExceededError(spentUsd, estimateUsd, dailyBudgetUsd);
      }
    },
  };
}
