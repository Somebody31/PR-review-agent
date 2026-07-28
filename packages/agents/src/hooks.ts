/**
 * Optional hooks the worker injects so agents stay free of DB imports.
 * Events are fire-and-awaited so cost rows land before the next budget check.
 */

/** One observability / cost event from the review pipeline. */
export type AgentHookEvent = {
  eventType: string;
  agent?: string;
  spanId?: string;
  parentSpan?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  outcome?: string;
  confidence?: number;
  payload?: Record<string, unknown>;
};

export type OnAgentEvent = (event: AgentHookEvent) => Promise<void>;

/** Called before each LLM request with a USD cost estimate. */
export type CheckBudget = (estimateUsd: number) => Promise<void>;

export type ReviewHooks = {
  onEvent?: OnAgentEvent;
  checkBudget?: CheckBudget;
};

/**
 * Emit an event when a hook is provided; no-op otherwise.
 */
export async function emitHookEvent(
  hooks: ReviewHooks | undefined,
  event: AgentHookEvent,
): Promise<void> {
  if (!hooks?.onEvent) {
    return;
  }
  await hooks.onEvent(event);
}
