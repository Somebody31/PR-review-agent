import { createLogger } from "@pr-review/core";

const logger = createLogger({ name: "worker" });

/**
 * Worker stub for Phase 0.
 * BullMQ consumer and LangGraph review come in later phases.
 */
function main(): void {
  logger.info("worker stub started (no queue consumer yet)");
}

main();
