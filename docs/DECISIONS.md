# Decisions log

Record architectural and product decisions here. Newest first within each section.

---

## ADR index

| ID | Title | Status |
|----|-------|--------|
| ADR-001 | TypeScript monorepo (not Python) | Accepted |
| ADR-002 | Modular monorepo; extract services only when measured | Accepted |
| ADR-003 | Single Postgres spine (+ pgvector); Redis for queue only | Accepted |
| ADR-004 | Simple TS orchestrator first; WorkflowEngine interface | Accepted |
| ADR-005 | Confidence-weighted HITL (human handles exceptions) | Accepted |
| ADR-006 | BudgetGuard hard-blocks over daily LLM spend | Accepted |

---

## ADR-001 — TypeScript monorepo

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Reference design uses Python (FastAPI, LangGraph, ARQ). Team preference is TypeScript.

**Decision:** Implement the entire system in TypeScript (API, worker, dashboard, shared packages).

**Consequences:**

- Single language across stack; Next.js dashboard shares types via packages.
- Use BullMQ instead of ARQ; Hono/Fastify instead of FastAPI; Zod instead of Pydantic.
- LangGraph.js optional later; not required for v1.

---

## ADR-002 — Modular monorepo

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Need clear module boundaries without premature microservices.

**Decision:** pnpm monorepo with `apps/*` and `packages/*`. Inward-only dependencies. API and worker are separate processes, same repo.

**Consequences:**

- Simple local dev and deployment.
- Can split deployables later without rewriting domain packages.

---

## ADR-003 — Single Postgres data spine

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Memory (vectors), truth (reviews), and time (events) could be three databases.

**Decision:** One Postgres with pgvector (local Docker first). Optional later move to Tiger/Timescale for hypertables and continuous aggregates. Redis only for BullMQ.

**Consequences:**

- Simpler ops and joins (review ↔ events ↔ costs).
- Must size vector indexes carefully as repos grow.
- Not forced into Qdrant + separate TSDB for MVP.

---

## ADR-004 — Orchestration approach

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Need parallel specialists and recoverable workflows.

**Decision:** v1 uses explicit TypeScript orchestration (`Promise.all` + timeouts) behind a `WorkflowEngine` interface. Revisit LangGraph.js or Temporal if durability/scale demands it.

**Consequences:**

- Faster to ship; less framework lock-in.
- Crash mid-job may restart from queue retry (idempotent steps required) rather than fine-grained graph checkpoints.

---

## ADR-005 — HITL policy

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Autonomy must be earned; CRITICAL mistakes are high consequence.

**Decision:** Default level = human handles exceptions. Auto-post only when confidence ≥ threshold and no CRITICAL. `AUTO_POST_ENABLED` starts false until eval baseline exists.

**Consequences:**

- Requires HITL UI/API before trusting production auto-post.
- Safer early UX; may create a queue that needs monitoring.

---

## ADR-006 — BudgetGuard

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Four LLM agents per PR can burn budget quickly.

**Decision:** Before each LLM call, check daily spend from `agent_events`; hard-block if over `DAILY_BUDGET_USD`.

**Consequences:**

- Protects cost; may leave reviews incomplete when blocked (route to failed/HITL with reason).

---

## Change log

| Date | Change |
|------|--------|
| 2026-07-26 | Initial architecture + implementation plan docs; ADRs 001–006 accepted for TypeScript build |
