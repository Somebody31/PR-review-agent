# PR Review Agent

Production-oriented **AI pull request review agent** in **TypeScript**.

GitHub PR → verify webhook → queue → LangGraph (four specialists: security, quality, tests, docs) with local Qwen3 RAG → merge & confidence gate → post review or HITL → full event/cost trail.

**Chat model:** DeepSeek V4 Flash (official API)  
**Embeddings:** Qwen3 Embedding (local OpenAI-compatible server)  
**Orchestration:** LangGraph.js  
**UI:** Next.js ops dashboard (`apps/web`) — server-side REST client (token never in browser)

## Monorepo layout

```
apps/api          Hono — webhooks + REST (HITL write + dispute)
apps/worker       BullMQ + LangGraph review
apps/web          Next.js dashboard (reviews, HITL, trace, economics)
packages/shared   Zod contracts
packages/core     config + logger + queue + secret mask
packages/db       Drizzle + pgvector schema
packages/github   Webhook HMAC, App auth, PR context
packages/agents   DeepSeek LLM, prompts, LangGraph graph
packages/memory   Chunk, hash, Qwen embed, index, retrieve
packages/evaluation  Golden fixtures + offline eval gate
```

## Quick start

```bash
# Install
pnpm install

# Typecheck & tests
pnpm typecheck
pnpm test

# Offline golden eval (no LLM keys required)
pnpm eval

# Infra (requires Docker)
docker compose up -d
pnpm db:migrate

# Optional: copy env
cp .env.example .env

# API + worker (needs DATABASE_URL + REDIS_URL + secrets)
pnpm --filter @pr-review/api dev
pnpm --filter @pr-review/worker dev

# Dashboard (port 3001) — needs API running + same API_AUTH_TOKEN
pnpm dev:web
# Or all three: pnpm dev:all
```

Local Qwen embed server is **not** in docker-compose — start it separately before RAG (Phase 5).

## Status

| Phase | Name | Status |
|-------|------|--------|
| **0** | Foundations | **Done** |
| **1** | Data spine | **Done** |
| **2** | Ingress & queue | **Done** |
| **3** | Context pipeline | **Done** |
| **4** | Agents & LangGraph | **Done** |
| **5** | Memory & RAG | **Done** (chunk/hash, local Qwen embed, incremental index, vector retrieve → `repoContext`) |
| **6** | Posting & reliability | **Done** (`withRetry`, GitHub PR review post, idempotent by head SHA) |
| **7** | Events, budget, REST | **Done** (`agent_events`, BudgetGuard UTC day, REST read API) |
| **8** | HITL write, security, evals | **Done** (HITL approve/reject, dispute, secret mask, golden eval) |
| **9** | CI & ops | **Done** (GitHub Actions CI, runbook, light learning hooks notes) |
| **10** | Dashboard UI | **Done** (Next.js `apps/web`: reviews, HITL, trace, economics) |

**MVP backend 0–9 + thin dashboard (Phase 10).** Agent loop remains API + worker; UI is a server-side client of the REST API.

### Phase 10 notes

- **App:** `apps/web` (Next.js App Router) on port **3001**.
- **Pages:** `/` reviews list · `/reviews/[id]` findings + dispute · `/reviews/[id]/trace` event timeline · `/hitl` approve/reject · `/economics` cost tables.
- **Auth:** server-only `API_AUTH_TOKEN` + `API_BASE_URL` (never sent to the browser). Mutations use Server Actions → REST.
- **Boundary:** dashboard talks to Hono REST only (no direct DB from Next). Prefer `pnpm --filter @pr-review/api dev` before opening the UI.
- No GitHub OAuth yet (token-in-env for ops); no chart library (tables only).

### Phase 9 notes

- **CI:** `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm eval` on push/PR to `master`/`main`.
- **Runbook:** see [Operations runbook](#operations-runbook) below.
- **Learning hooks (light):** weekly dispute/rejection rates by agent via SQL on `hitl_feedback` / `agent_events` (documented in runbook). Prompt changes require a new prompt version + green `pnpm eval` before promote. No automatic prompt mutation from a single dispute.

### Phase 8 notes

- **HITL queue:** worker inserts `hitl_items` when outcome is `hitl_queue` or `critical_escalate` (no auto post).
- REST (Bearer `API_AUTH_TOKEN`):
  - `GET /api/hitl` — list queue
  - `POST /api/hitl/:id/approve` — post review to GitHub, mark approved
  - `POST /api/hitl/:id/reject` — close without post (optional JSON `{ "comment" }`)
  - `POST /api/findings/:id/dispute` — store `hitl_feedback` only (no auto prompt change)
- **Security:** `maskSecrets()` redacts PEM keys / GitHub tokens / `sk-` keys / Bearer tokens in logs, agent event error payloads, and LLM user messages. App secrets (`GITHUB_PRIVATE_KEY`, webhook secret) are never put into LLM prompts — only PR title/body/diff/RAG context. Webhook path is HMAC-verified, delivery-idempotent, and lightly rate-limited per IP (60/min). Local threat model: `docs/SECURITY.md` (not in git).
- **HITL approve/reject:** claim `pending→approved|rejected` **before** any GitHub post (approve) so concurrent reject cannot leave a post while HITL is rejected. Idempotent by head SHA (reuses `github_review_id`). Retries when HITL is already approved/rejected still call `finishReview` if `pr_reviews` is stuck `hitl_pending`. Finish sets `outcome=auto_post` (approve) or `hitl_rejected` (reject) with `status=completed`.
- **Dispute / learning (8.2):** single disputes are stored only — **no** automatic prompt or policy mutation. Future continuous learning (Phase 9) must require a **minimum evidence threshold** before any change (suggested baseline: ≥5 disputes for the same agent+category within 30 days, plus human review of the batch). One-off or sparse disputes never auto-tune.
- **Eval:** `packages/evaluation` has 6 synthetic fixture diffs + specialist prompt contract checks; `pnpm eval` fails if precision/recall fall below thresholds (default P≥0.7, R≥0.8) **or** a specialist prompt loses required focus language.
- **Auto-post:** keep `AUTO_POST_ENABLED=false` until golden eval is green on your prompts/model **and** you accept HITL rate in staging. Enable only after monitoring dispute rate; CRITICAL still escalates regardless.
- Dashboard was deferred in MVP (ADR-009); shipped later as Phase 10.

### Phase 7 notes

- `emitAgentEvent` + helpers in `@pr-review/db`; timeline queryable by `review_id`.
- Worker emits `review_start` / `review_end` / `review_failed` / `github_post`; agents emit `agent_start` / `llm_call` / `agent_end` / `aggregate`.
- **BudgetGuard:** sums billable `cost_usd` on **`llm_call` only** for the **UTC calendar day** (not `agent_end` / `review_end`); before each LLM call if `spent + estimate > DAILY_BUDGET_USD` → budget error, review `failed`, `budget_block` event.
- REST (Bearer `API_AUTH_TOKEN`): `GET /api/reviews`, `/api/reviews/:id`, `/api/reviews/:id/events`, `/api/economics/summary`, `/api/hitl`.

### Phase 6 notes

- Worker posts a GitHub PR review **only** when outcome is `auto_post`.
- `AUTO_POST_ENABLED` still defaults to **false** (aggregator forces `hitl_queue` until enabled).
- Post uses `withRetry` (exponential backoff + jitter) on retryable HTTP errors.
- Idempotent: `findPostedReviewByHead` skips a second post for the same owner/repo/PR/head SHA and reuses `github_review_id`.
- `github_review_id` is written via `setGithubReviewId` immediately after a successful post (before `finishReview`) so a crash does not re-post duplicates.
- Review body groups findings by severity; inline comments only when `filePath` + `lineStart` appear in the PR patch (else body-only listing).
- If GitHub rejects inline comments, the post falls back to a body-only review so findings still land on the PR.
- `REQUEST_CHANGES` only for CRITICAL/HIGH; otherwise `COMMENT`.

### Phase 5 notes

- Worker indexes changed PR files when content hash changes; soft-fails if the embed server is down (diff-only review still runs).
- Retrieved chunks are injected into specialist prompts under repository context.
- Embeddings: OpenAI-compatible `POST {EMBEDDING_BASE_URL}/embeddings` (default Qwen3 local).

## Operations runbook

### Fresh environment

```bash
# 1. Clone + install
git clone git@github.com:Somebody31/PR-review-agent.git
cd PR-review-agent
pnpm install

# 2. Infra
docker compose up -d
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, GITHUB_*, DEEPSEEK_API_KEY, API_AUTH_TOKEN

# 3. Schema
pnpm db:migrate

# 4. Processes
pnpm --filter @pr-review/api dev
pnpm --filter @pr-review/worker dev
pnpm dev:web   # dashboard http://127.0.0.1:3001

# 5. Optional RAG (local Qwen OpenAI-compatible embeddings)
# Point EMBEDDING_BASE_URL at your server (default http://127.0.0.1:8000/v1)
```

### Env checklist

| Variable | Required for |
|----------|----------------|
| `DATABASE_URL` | API + worker |
| `REDIS_URL` | API enqueue + worker |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC |
| `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` | PR fetch + post |
| `DEEPSEEK_API_KEY` | Agents |
| `API_AUTH_TOKEN` | REST / HITL mutations + web server |
| `API_BASE_URL` | Web dashboard → API (default `http://127.0.0.1:3000`) |
| `AUTO_POST_ENABLED` | Default `false` — keep off until eval + staging OK |
| `HITL_CONFIDENCE_THRESHOLD` | Default `0.75` |
| `DAILY_BUDGET_USD` | Default `20` (UTC day, `llm_call` costs) |
| `EMBEDDING_*` | RAG only (soft-fail if down) |

### Scale workers

- Start more worker processes with the same `REDIS_URL` / `DATABASE_URL`.
- BullMQ concurrency defaults low (1) in worker bootstrap — raise carefully vs LLM budget.

### Rotate GitHub webhook secret

1. Generate a new secret in the GitHub App / webhook settings.
2. Set `GITHUB_WEBHOOK_SECRET` on the API and restart.
3. Old deliveries already stored by id stay idempotent; no DB wipe needed.

### Replay failed jobs

- Inspect BullMQ failed set (Redis) or re-deliver the webhook from GitHub (same `X-GitHub-Delivery` is ignored as duplicate — use a new delivery or delete that row only if you intend a full re-run).
- For a new review of the same PR head, push a new commit (new head SHA) or clear `github_review_id` only when you knowingly accept a second post.

### HITL ops

```bash
# List queue
curl -s -H "Authorization: Bearer $API_AUTH_TOKEN" http://localhost:3000/api/hitl

# Approve (posts to GitHub when not already posted for that head)
curl -s -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" \
  http://localhost:3000/api/hitl/<hitlId>/approve

# Reject (no GitHub post)
curl -s -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment":"not useful"}' \
  http://localhost:3000/api/hitl/<hitlId>/reject
```

### Budget tripped

- Review `agent_events` with `event_type = 'budget_block'` and `llm_call` costs for the UTC day.
- Raise `DAILY_BUDGET_USD` or wait until next UTC day; failed reviews stay `failed`.

### Weekly learning query (manual)

```sql
-- Dispute rate by agent (last 7 days)
SELECT f.agent_type, count(*) AS disputes
FROM hitl_feedback fb
JOIN findings f ON f.id = fb.finding_id
WHERE fb.action = 'dispute'
  AND fb.created_at > now() - interval '7 days'
GROUP BY f.agent_type
ORDER BY disputes DESC;
```

Promote a prompt change only after: new version in agents prompts + green `pnpm eval` + review of disputes (≥5 same agent+category / 30 days suggested).

### Health

```bash
curl -s http://localhost:3000/health
```

## License

TBD
