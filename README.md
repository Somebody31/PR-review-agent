# PR Review Agent

Production-oriented **AI pull request review agent** in **TypeScript**.

GitHub PR → verify webhook → queue → LangGraph (four specialists: security, quality, tests, docs) with local Qwen3 RAG → merge & confidence gate → post review or HITL → full event/cost trail.

**Chat model:** DeepSeek V4 Flash (official API)  
**Embeddings:** Qwen3 Embedding (local OpenAI-compatible server)  
**Orchestration:** LangGraph.js  
**UI:** deferred (REST-first HITL; no Next.js in MVP)

## Monorepo layout

```
apps/api          Hono — webhooks + REST (HITL write + dispute)
apps/worker       BullMQ + LangGraph review
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
| **7** | Events, budget, REST | **Done** (`agent_events`, BudgetGuard UTC day, REST read API; no Next.js) |
| **8** | HITL write, security, evals | **Done** (HITL approve/reject, dispute, secret mask, golden eval) |

**Next:** Phase **9** — CI/CD polish & ops.

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
- No Next.js (ADR-009).

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

## License

TBD
