# Agent rules — PR Review Agent

Follow these when changing this repo. Local ADRs/plan: `docs/` (see below).

## `docs/` is local only — never push

- The `docs/` folder is **gitignored**. Do **not** `git add`, commit, or push it.
- Keep architecture notes, IMPLEMENTATION steps, and DECISIONS updates **on disk only**.
- Do not re-add `docs/` to the remote.

## Do not overbuild (ADR-011)

- Build **only** what the current step’s green gate needs.
- One phase/step at a time; stop when the gate passes.
- No empty packages or stubs for future phases.
- No abstractions “for later” (factories, DI, extra interfaces, premature HITL/UI).
- Prefer extending an existing file over adding a package.
- Do not wire GitHub / LLM / RAG / HITL until that phase starts.

## Beginner-readable TypeScript (ADR-010)

- Plain functions over classes, generics gymnastics, DI, decorators.
- Explicit types on params and returns.
- Short single-purpose functions; named intermediate variables.
- No stacked one-liners or clever TS types unless asked.
- Prefer native APIs (`fetch`) when ergonomic.
- Comments explain **why**, not restating **what**.
- Plain `try/catch`; no Result monads / custom error frameworks by default.
- When simple vs complex: choose simple.

## Stack locks

| Area | Choice |
|------|--------|
| Chat LLM | DeepSeek V4 Flash (`deepseek-v4-flash`, official API) |
| Embeddings | Local Qwen3 (OpenAI-compatible server) |
| Orchestration | LangGraph.js (plain function nodes) |
| Apps (MVP) | `api` + `worker` only — no Next.js day one |
| Data | Postgres + pgvector; Redis for BullMQ only |

## Decisions log

Meaningful product/architecture changes: append to `docs/DECISIONS.md` in the same turn.
