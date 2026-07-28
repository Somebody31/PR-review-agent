# Decisions log

Record architectural and product decisions here. Newest first within each section.

---

## ADR index

| ID | Title | Status |
|----|-------|--------|
| ADR-001 | TypeScript monorepo (not Python) | Accepted |
| ADR-002 | Modular monorepo; extract services only when measured | Accepted |
| ADR-003 | Single Postgres spine (+ pgvector); Redis for queue only | Accepted |
| ADR-004 | LangGraph.js orchestration (supersedes Promise.all-first) | **Superseded by 004-bis** |
| ADR-004-bis | LangGraph.js for review graph | Accepted |
| ADR-005 | Confidence-weighted HITL (human handles exceptions) | Accepted |
| ADR-006 | BudgetGuard hard-blocks over daily LLM spend | Accepted |
| ADR-007 | DeepSeek V4 Flash direct API for chat | Accepted |
| ADR-008 | Local Qwen3 embeddings | Accepted |
| ADR-009 | Dashboard deferred; REST-first HITL (no day-one Next.js) | Accepted |
| ADR-010 | Beginner-readable TypeScript style | Accepted |
| ADR-011 | Do not overbuild | Accepted |

---

## ADR-001 — TypeScript monorepo

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Reference design uses Python (FastAPI, LangGraph, ARQ). Team preference is TypeScript.

**Decision:** Implement the entire system in TypeScript (API, worker, shared packages). Dashboard optional later.

**Consequences:**

- Single language across stack.
- Use BullMQ instead of ARQ; Hono instead of FastAPI; Zod instead of Pydantic.
- LangGraph.js for orchestration (see ADR-004-bis).

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

## ADR-004 — Orchestration approach (original)

**Date:** 2026-07-26  
**Status:** Superseded by ADR-004-bis  

**Decision (original):** v1 uses explicit TypeScript orchestration (`Promise.all` + timeouts) behind a `WorkflowEngine` interface.

---

## ADR-004-bis — LangGraph.js orchestration

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** Team chose LangGraph for the review workflow graph (parallel specialists, clear nodes, future HITL interrupts / checkpoints).

**Decision:** Use `@langchain/langgraph` StateGraph:

`loadContext → [security | quality | tests | docs] → aggregate → route`

Nodes are plain functions. No class-based agents. Checkpointer optional; BullMQ retries cover job-level recovery in v1.

**Consequences:**

- Graph structure is explicit and testable.
- Slight framework cost vs raw `Promise.all`.
- Keep graph simple — avoid LangChain agent abstractions for v1.

---

## ADR-005 — HITL policy

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Autonomy must be earned; CRITICAL mistakes are high consequence.

**Decision:** Default level = human handles exceptions. Auto-post only when confidence ≥ threshold and no CRITICAL. `AUTO_POST_ENABLED` starts false until eval baseline exists.

**Consequences:**

- Requires HITL API (and optional UI) before trusting production auto-post.
- Safer early UX; may create a queue that needs monitoring.

---

## ADR-006 — BudgetGuard

**Date:** 2026-07-26  
**Status:** Accepted  

**Context:** Four LLM agents per PR can burn budget quickly.

**Decision:** Before each LLM call, check daily spend from `agent_events`; hard-block if over `DAILY_BUDGET_USD`. Tracks DeepSeek (chat) cost; local embeds are $0.

**Consequences:**

- Protects cost; may leave reviews incomplete when blocked (route to failed/HITL with reason).

---

## ADR-007 — DeepSeek V4 Flash for chat

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** Need a cheap, fast coding-capable model for four specialist agents per PR.

**Decision:** Call DeepSeek official API directly (`https://api.deepseek.com`, model `deepseek-v4-flash`) via OpenAI-compatible client. Not OpenRouter or other proxies by default.

**Consequences:**

- Env: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `LLM_MODEL`.
- Cost table in BudgetGuard uses Flash pricing.

---

## ADR-008 — Local Qwen3 embeddings

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** RAG grounding without cloud embed spend; prefer self-hosted Qwen3.

**Decision:** Run Qwen3 Embedding locally (vLLM / Ollama / TEI). App calls OpenAI-compatible `/v1/embeddings` at `EMBEDDING_BASE_URL`. Default model size 0.6B.

**Consequences:**

- docker-compose does not start the embed server; ops must start it separately.
- Worker should fail clearly if embed endpoint is down when RAG is required.

---

## ADR-009 — Dashboard deferred (no day-one Next.js)

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** Next.js was in the original architecture only for HITL / traces / cost UI. The agent loop does not need a browser app.

**Decision:** MVP apps are `api` + `worker` only. HITL and ops via REST + curl/SQL. Optional thin UI later.

**Consequences:**

- Faster to Slice C (GitHub comments).
- Operators need API auth token for mutations.

---

## ADR-010 — Beginner-readable TypeScript

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** Prefer code a junior can follow over clever abstractions.

**Decision:** Plain functions, explicit types, short single-purpose helpers, named intermediates, plain try/catch, comments for *why*, no DI/factories/clever types by default. LangGraph nodes stay plain async functions.

**Consequences:**

- Slightly more verbose code; easier reviews and onboarding.

---

## ADR-011 — Do not overbuild

**Date:** 2026-07-28  
**Status:** Accepted  

**Context:** Easy to scaffold unused packages, abstractions “for later,” and multi-phase work in one PR. That slows shipping and fights beginner readability (ADR-010).

**Decision:** Only build what the **current step’s green gate** needs.

Rules:

1. One phase/step at a time; stop when the gate passes.
2. No empty packages or stub modules for future phases.
3. No abstractions for a second use-case that does not exist yet.
4. Prefer extending an existing file over a new package.
5. Do not wire GitHub/LLM/RAG/HITL until that phase starts.
6. Docs: log real decisions; do not invent parallel design systems.

**Consequences:**

- Smaller diffs; clearer reviews.
- May rename/move code when a second real need appears (acceptable).

---

## Change log

| Date | Change |
|------|--------|
| 2026-07-26 | Initial architecture + implementation plan docs; ADRs 001–006 accepted for TypeScript build |
| 2026-07-28 | Phase 0 scaffold; ADR-004-bis LangGraph; ADR-007 DeepSeek Flash; ADR-008 local Qwen3; ADR-009 REST-first (no Next.js); ADR-010 code style |
| 2026-07-28 | ADR-011 do not overbuild; phase status check |
