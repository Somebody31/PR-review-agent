# PR Review Agent

Production-oriented **AI pull request review agent** in **TypeScript**.

GitHub PR → verify webhook → queue → LangGraph (four specialists: security, quality, tests, docs) with local Qwen3 RAG → merge & confidence gate → post review or HITL → full event/cost trail.

**Chat model:** DeepSeek V4 Flash (official API)  
**Embeddings:** Qwen3 Embedding (local OpenAI-compatible server)  
**Orchestration:** LangGraph.js  
**UI:** deferred (REST-first HITL; no Next.js in MVP)

## Monorepo layout

```
apps/api          Hono — webhooks + REST
apps/worker       BullMQ + LangGraph review
packages/shared   Zod contracts
packages/core     config + logger + queue helpers
packages/db       Drizzle + pgvector schema
packages/github   Webhook HMAC + PR event parse (+ more as phases land)
```

## Quick start

```bash
# Install
pnpm install

# Typecheck & tests
pnpm typecheck
pnpm test

# Infra (requires Docker)
docker compose up -d

# Optional: copy env
cp .env.example .env

# API + worker (needs DATABASE_URL + REDIS_URL)
pnpm --filter @pr-review/api dev
pnpm --filter @pr-review/worker dev
```

Local Qwen embed server is **not** in docker-compose — start it separately before RAG (Phase 5).

## Status

| Phase | Name | Status |
|-------|------|--------|
| **0** | Foundations | **Done** |
| **1** | Data spine | **Done** |
| **2** | Ingress & queue | **Done** (HMAC webhook, delivery idempotency, BullMQ, worker skeleton) |
| **3** | Context pipeline | **Done** (GitHub App auth, PR context fetch, review shell) |
| 4 | Agents & LangGraph | Not started |
| 5+ | RAG → … | Not started |

**Next:** Phase **4** — DeepSeek structured LLM, four specialists, LangGraph aggregate, persist findings.

Docker Compose green gate: run `docker compose up -d` where Docker is available (not verified on all machines).

## License

TBD
