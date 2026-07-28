# PR Review Agent

Production-oriented **AI pull request review agent** in **TypeScript**.

GitHub PR → verify webhook → queue → LangGraph (four specialists: security, quality, tests, docs) with local Qwen3 RAG → merge & confidence gate → post review or HITL → full event/cost trail.

**Chat model:** DeepSeek V4 Flash (official API)  
**Embeddings:** Qwen3 Embedding (local OpenAI-compatible server)  
**Orchestration:** LangGraph.js  
**UI:** deferred (REST-first HITL; no Next.js in MVP)

## Docs

Planning and ADRs live in local `docs/` (**not tracked in git** — do not push).

## Monorepo layout

```
apps/api          Hono — webhooks + REST
apps/worker       BullMQ + LangGraph review
packages/shared   Zod contracts
packages/core     config + logger
packages/*        (more as phases land)
```

## Quick start (Phase 0)

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
```

Local Qwen embed server is **not** in docker-compose — start it separately before RAG (Phase 5).

## Status

| Phase | Name | Status |
|-------|------|--------|
| **0** | Foundations | **Done** (code gates: install / typecheck / tests) |
| 1 | Data spine | Not started |
| 2 | Ingress & queue | Not started |
| 3+ | Context → agents → … | Not started |

**Next:** Step **1.1** — `packages/db` Drizzle connect + migrate + `SELECT 1` (only that; no overbuild).

Docker Compose green gate: run `docker compose up -d` where Docker is available (not verified on all machines).

## License

TBD
