# Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design: components, data, flows, ADRs summary |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Step-by-step build plan with green gates |
| [DECISIONS.md](./DECISIONS.md) | Architecture Decision Records and change log |

**Stack:** TypeScript monorepo (API + worker; no Next.js day one), Postgres + pgvector, Redis + BullMQ, GitHub App, DeepSeek V4 Flash, local Qwen3 embeddings, LangGraph.js.

**Rules:** [AGENTS.md](../AGENTS.md) — beginner style + do not overbuild.

**Current:** Phase **0 done**. Next: [IMPLEMENTATION.md](./IMPLEMENTATION.md) **Step 1.1**.
