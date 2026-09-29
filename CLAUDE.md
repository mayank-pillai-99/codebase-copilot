# CLAUDE.md

Codebase Copilot: paste a GitHub URL, get an onboarding guide to that codebase, grounded in the code with file/line citations. Portfolio project targeting full-stack and AI engineer roles.

**Full specification: `docs/SPEC.md`.** Read the relevant section before starting a milestone. If implementation needs to diverge from the spec, update the spec and add an ADR in `docs/decisions/`.

## Current status

Milestone 0: spec only, no code yet. Next: Milestone 1 (foundation). See `docs/SPEC.md` §21.

## Stack

- `apps/web`: Next.js (App Router), React, TypeScript, Tailwind
- `apps/api`: Fastify, zod, Prisma, LangChain.js, BullMQ, web-tree-sitter. Two entry points: `server.ts` and `worker.ts`
- `packages/shared`: shared types and zod schemas
- `ml/`: Python training only; inference runs in Node
- `eval/`: evaluation datasets and runners
- Postgres + pgvector, Redis, Docker Compose

## Commands

_To be filled in during Milestone 1._

## Hard rules

- **Never execute code from indexed repositories.** No installs, builds, or evaluating their config. Repos are data.
- **Prisma is the only ORM.** Use parameterized raw SQL (`prisma.$queryRaw` tagged templates) only for `vector`/`tsvector` columns and operators. Never string-concatenate SQL.
- **All code data is scoped to a `Snapshot` (one commit).** Never mix snapshots in retrieval, caching, or answers.
- **Citations are validated server-side.** File paths and line numbers shown to users come from the database, never directly from LLM output.
- **Never invent evaluation or ML numbers.** Unmeasured means "not measured yet".
- **Free-tier deployable, no credit card.** Do not add paid dependencies, extra services, microservices, or a separate vector DB or Python server.
- Secrets only in env vars. Keep `.env.example` updated and never commit `.env*`.
- Redis, LLM and embedding providers stay behind adapters in `src/lib/` and `src/llm/`.
- Out of scope unless the spec changes: code generation or modification, test generation, private repos, non-TS/JS languages.

## Conventions

- TypeScript `strict`. No `any` without a justifying comment.
- Route handlers stay thin; logic lives in `services/`, data access in `repositories/`.
- Validate every API input with zod schemas from `packages/shared`.
- Write tests with each feature, not at the end. Parsing and detection get fixture-based tests.
- Deterministic analysis (parsing, graphs, routes, stack detection) comes first; the LLM names, summarizes, and explains.
- Log with pino (structured). Never log secrets, passwords, tokens, or full file contents.
- User-facing errors are short and actionable; stack traces stay in the logs.
- Small, focused commits.
