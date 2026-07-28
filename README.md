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
packages/github   Webhook HMAC, App auth, PR context
packages/agents   DeepSeek LLM, prompts, LangGraph graph
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
pnpm db:migrate

# Optional: copy env
cp .env.example .env

# API + worker (needs DATABASE_URL + REDIS_URL + secrets)
pnpm --filter @pr-review/api dev
pnpm --filter @pr-review/worker dev
```

Local Qwen embed server is **not** in docker-compose — start it separately before RAG (Phase 5).

## Status

| Phase | Name | Status |
|-------|------|--------|
| **0** | Foundations | **Done** |
| **1** | Data spine | **Done** |
| **2** | Ingress & queue | **Done** |
| **3** | Context pipeline | **Done** |
| **4** | Agents & LangGraph | **Done** (DeepSeek structured LLM, 4 specialists, aggregate, findings in DB) |
| 5 | Memory & RAG | Not started |
| 6+ | Post → HITL → CI | Not started |

**Next:** Phase **5** — chunk + local Qwen embed, hybrid retrieve, inject into agents.

## License

TBD
