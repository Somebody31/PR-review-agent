# PR Review Agent

AI-assisted pull request review for GitHub. A TypeScript monorepo that receives webhooks, runs four specialist agents, and either posts a review or queues it for human approval.

```
GitHub PR → webhook → queue → specialists (+ optional RAG) → post or HITL → events & cost trail
```

| Layer | Choice |
|-------|--------|
| Chat model | DeepSeek V4 Flash |
| Embeddings | Local Qwen3 (OpenAI-compatible server) |
| Orchestration | LangGraph.js |
| API | Hono |
| Queue | BullMQ + Redis |
| Data | Postgres + pgvector |
| Dashboard | Next.js (`apps/web`) |

---

## Features

- **Webhook ingress** — HMAC verification, delivery idempotency, light rate limiting
- **Four specialists** — security, quality, tests, and docs (parallel), then merge + confidence gate
- **Optional RAG** — index changed files with local embeddings; soft-fails if the embed server is down
- **GitHub reviews** — severity-grouped body, diff-aware inline comments, retries, idempotent by head SHA
- **Human-in-the-loop** — approve (post) or reject (no post); claim-before-post; finding disputes without auto prompt changes
- **Budget guard** — daily UTC spend cap on billable `llm_call` events
- **Ops surface** — REST API + dashboard (reviews, timeline, HITL queue, economics)
- **Quality gate** — offline golden eval (`pnpm eval`) in CI

Auto-post defaults to **off** (`AUTO_POST_ENABLED=false`). Enable only after eval and staging confidence look good.

---

## Repository layout

```
apps/api           Webhooks + REST API
apps/worker        BullMQ consumer + review pipeline
apps/web           Ops dashboard (port 3001)
packages/shared    Shared contracts (Zod)
packages/core      Config, logger, queue, secret masking
packages/db        Drizzle schema and queries
packages/github    GitHub App, webhooks, PR context, post review
packages/agents    LLM, prompts, LangGraph graph, aggregation
packages/memory    Chunk, embed, index, retrieve
packages/evaluation Offline fixtures and eval runner
```

---

## Quick start

**Requirements:** Node 22+, pnpm 9, Docker (Postgres + Redis).

```bash
git clone git@github.com:Somebody31/PR-review-agent.git
cd PR-review-agent
pnpm install

cp .env.example .env
# Set DATABASE_URL, REDIS_URL, GITHUB_*, DEEPSEEK_API_KEY, API_AUTH_TOKEN

docker compose up -d
pnpm db:migrate

pnpm --filter @pr-review/api dev      # http://127.0.0.1:3000
pnpm --filter @pr-review/worker dev
pnpm dev:web                         # http://127.0.0.1:3001
# or: pnpm dev:all
```

Point your GitHub App webhook at `POST /webhooks/github` with the same `GITHUB_WEBHOOK_SECRET`.

Local embeddings are **not** started by docker-compose. Set `EMBEDDING_*` if you run a Qwen-compatible server; otherwise reviews still run on the PR diff only.

### Checks

```bash
pnpm typecheck
pnpm test
pnpm eval    # offline; no live LLM keys required
```

CI runs the same gates on push/PR (see `.github/workflows/ci.yml`).

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection |
| `REDIS_URL` | BullMQ |
| `PORT` | API listen port (default `3000`) |
| `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` | PR fetch and review post |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC |
| `DEEPSEEK_API_KEY` | Specialist agents |
| `DEEPSEEK_BASE_URL` / `LLM_MODEL` | Chat API (defaults set for DeepSeek Flash) |
| `API_AUTH_TOKEN` | Bearer token for REST and dashboard server |
| `API_BASE_URL` | Dashboard → API (default `http://127.0.0.1:3000`) |
| `AUTO_POST_ENABLED` | Auto-post when confidence allows (default `false`) |
| `HITL_CONFIDENCE_THRESHOLD` | Default `0.75` |
| `DAILY_BUDGET_USD` | UTC-day LLM spend cap (default `20`) |
| `EMBEDDING_*` | Optional RAG |

See `.env.example` for the full template.

---

## How it works

1. **Ingress** — GitHub sends a `pull_request` event. The API verifies the signature, records the delivery id, and enqueues a job.
2. **Context** — The worker loads the PR via the GitHub App and optionally retrieves RAG context.
3. **Review** — Four specialists run in parallel (budget checked before each LLM call), then findings are aggregated.
4. **Outcome**
   - `auto_post` — post a GitHub review (when enabled and confidence is high enough)
   - `hitl_queue` / `critical_escalate` — queue for a human; no automatic post
   - `failed` — hard error or budget block
5. **HITL** — Approve posts (claim state first); reject closes without posting. Disputes store feedback only.
6. **Observability** — `agent_events` record timeline and billable cost; REST and the dashboard expose the same data.

The dashboard is a **server-side** client of the API. `API_AUTH_TOKEN` is never sent to the browser.

---

## HTTP API

All routes below (except `/health` and the webhook) require:

```http
Authorization: Bearer <API_AUTH_TOKEN>
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness + DB ping |
| `POST` | `/webhooks/github` | GitHub webhook |
| `GET` | `/api/reviews` | List reviews |
| `GET` | `/api/reviews/:id` | Review + findings + event summary |
| `GET` | `/api/reviews/:id/events` | Event timeline |
| `GET` | `/api/economics/summary` | Cost by agent and day |
| `GET` | `/api/hitl` | HITL queue |
| `POST` | `/api/hitl/:id/approve` | Approve and post |
| `POST` | `/api/hitl/:id/reject` | Reject without post (`{ "comment" }` optional) |
| `POST` | `/api/findings/:id/dispute` | Record dispute feedback |

### HITL examples

```bash
curl -s -H "Authorization: Bearer $API_AUTH_TOKEN" \
  http://127.0.0.1:3000/api/hitl

curl -s -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" \
  http://127.0.0.1:3000/api/hitl/<hitlId>/approve

curl -s -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment":"not useful"}' \
  http://127.0.0.1:3000/api/hitl/<hitlId>/reject
```

### Dashboard

| Path | View |
|------|------|
| `/` | Reviews |
| `/reviews/[id]` | Findings and dispute |
| `/reviews/[id]/trace` | Event timeline |
| `/hitl` | Approve / reject |
| `/economics` | Cost tables |

---

## Operations

### Scale workers

Run more worker processes with the same `REDIS_URL` and `DATABASE_URL`. Keep concurrency low relative to `DAILY_BUDGET_USD`.

### Rotate webhook secret

1. Create a new secret in the GitHub App settings.
2. Update `GITHUB_WEBHOOK_SECRET` and restart the API.
3. Existing delivery ids remain idempotent; no database wipe required.

### Replay a review

Re-deliver from GitHub only works with a **new** delivery id (duplicates are ignored). For a new review of the same PR tip, push a commit (new head SHA) or intentionally clear post state if you accept a second GitHub review.

### Budget limit hit

Inspect `agent_events` for `budget_block` and `llm_call` costs for the current UTC day. Raise `DAILY_BUDGET_USD` or wait for the next UTC day. Failed reviews stay `failed`.

### Prompt changes

Do not auto-tune prompts from a single dispute. Promote only after a new prompt version, green `pnpm eval`, and a batch review of related disputes (for example ≥5 for the same agent and category within 30 days).

```sql
SELECT f.agent_type, count(*) AS disputes
FROM hitl_feedback fb
JOIN findings f ON f.id = fb.finding_id
WHERE fb.action = 'dispute'
  AND fb.created_at > now() - interval '7 days'
GROUP BY f.agent_type
ORDER BY disputes DESC;
```

---

## Security notes

- Webhook path is HMAC-verified and delivery-idempotent.
- REST and dashboard mutations require `API_AUTH_TOKEN`.
- `maskSecrets` redacts common secret shapes in logs, event payloads, and LLM user text.
- App private keys and webhook secrets are never sent to the model; prompts use PR content and optional RAG context only.

---


