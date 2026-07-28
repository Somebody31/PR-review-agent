# PR Review Agent

Production-oriented **AI pull request review agent** in **TypeScript**.

GitHub PR → verify webhook → queue → LangGraph (four specialists: security, quality, tests, docs) with local Qwen3 RAG → merge & confidence gate → post review or HITL → full event/cost trail.

**Chat model:** DeepSeek V4 Flash (official API)  
**Embeddings:** Qwen3 Embedding (local OpenAI-compatible server)  
**Orchestration:** LangGraph.js  
**UI:** deferred (REST-first HITL; no Next.js in MVP)

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Architecture plan |
| [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) | Implementation steps (phased) |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | ADRs |

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

Phase 0 foundations in progress (monorepo scaffold, config, shared contracts).

## License

TBD
