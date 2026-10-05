# CLAUDE.md

Codebase Copilot: paste a GitHub URL, get an onboarding guide to that codebase, grounded in the code with file/line citations. Portfolio project targeting full-stack and AI engineer roles.

**Full specification: `docs/SPEC.md`.** Read the relevant section before starting a milestone. If implementation needs to diverge from the spec, update the spec and add an ADR in `docs/decisions/`.

## Current status

Milestones 1–4 are done: foundation, auth (ADR 0002), repository ingestion (ADR 0003), and search + grounded chat (ADR 0004): symbol chunks, gemini-embedding-2 vectors, hybrid retrieval, streamed chat with server-validated citations, the code viewer, public demo repositories, and free-tier deploy config (`docs/deployment.md`). Milestone 7 is done (ADR 0006): architecture map and request tracing, deterministic only. Milestone 9 is done (ADR 0007): the onboarding guide is the default repository tab, with one cached, labelled AI summary. Milestone 5's evaluation harness (ADR 0005) is built but was not run or published, by decision (2026-09-30): the questions were LLM-drafted. The code stays; nothing in the UI or README links to `/eval`. Remaining: Milestones 6, 8 and 10. See `docs/SPEC.md` §21.

## Stack

- `apps/web`: Next.js (App Router), React, TypeScript, Tailwind
- `apps/api`: Fastify, zod, Prisma, LangChain.js, BullMQ, web-tree-sitter. Two entry points: `server.ts` and `worker.ts`
- `packages/shared`: shared types and zod schemas
- `ml/`: Python training only; inference runs in Node
- `eval/`: evaluation datasets and runners
- Postgres + pgvector, Redis, Docker Compose

## Commands

Run from the repo root. Local config is one `.env` at the root (`cp .env.example .env`).

```bash
npm install                 # also runs `prisma generate` for the API
npm run infra:up            # Postgres (host port 5433) + Redis via Docker
npm run db:migrate          # prisma migrate dev (creates/applies migrations)
npm run dev                 # API :4000, indexing worker, web :3000 (or dev:api / dev:web)
npm run lint && npm run format:check && npm run typecheck
npm test                    # unit tests; add RUN_INTEGRATION=1 with DATABASE_URL/REDIS_URL set for integration
npm run build && npm run test:e2e   # Playwright browser tests (e2e/); seeds an offline demo repo, uses ports 3000/4000
npm run build
GITHUB_TOKEN=$(gh auth token) npm run eval   # retrieval evaluation (eval/README.md); -- --draft for a trial run
docker compose --profile app up --build   # whole stack in containers
```

- Prisma 7: schema in `apps/api/prisma/schema.prisma`, config in `apps/api/prisma.config.ts`, client generated to `apps/api/src/generated/prisma` (gitignored); connect through `src/lib/prisma.ts` (pg driver adapter).
- Extension or index SQL that Prisma can't express goes in hand-written migrations; afterwards, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` must print an empty migration.
- `packages/shared` ships TypeScript source: the API bundles it with tsup, and Next.js uses `transpilePackages`.
- Don't put `NODE_ENV` in `.env`. It breaks `next build`.
- Auth: protect API routes with `{ preHandler: app.authenticate }` (the user id is in `request.user.sub`), and check ownership with `assertOwnedBy()` from `src/lib/authz.ts`. On the web side, use `requireUser(path)` / `getCurrentUser()` from `src/lib/session.ts`.
- Fastify replies are thenable: never resolve an async helper to `reply`, or the handler deadlocks.
- Web tests: `npm test --workspace @codebase-copilot/web` (vitest, pure `lib/` functions).
- Indexing lives in `apps/api/src/indexing/`: `tarball.ts` (in-memory extraction and limits) → `parser.ts` (tree-sitter) → `routes.ts` → `modules.ts` (import resolution) → `graph.ts` (links calls and handlers) → `persist.ts`, orchestrated by `indexer.ts`. Test repos are built in memory with `tests/support/tar.ts` and `fixture-repo.ts`.
- Integration tests: `RUN_INTEGRATION=1` with `DATABASE_URL` and `REDIS_URL` set. They use unique names and clean up after themselves.
- Migrations: `prisma migrate dev --create-only` always adds `DROP INDEX "chunks_embedding_hnsw_idx"`, because Prisma can't declare HNSW. **Delete that line** before applying (use `prisma migrate deploy` in non-interactive shells). `npm run db:check-drift --workspace @codebase-copilot/api` (in CI) catches anything else.
- Retrieval and chat: `src/retrieval/` (vector, fulltext and hybrid, all behind the `Retriever` interface), `src/chat/` (prompt, citation checks, service), `src/llm/` (Gemini embeddings as a LangChain `Embeddings`; chat through `GeminiChat`, our LangChain `BaseChatModel` over the REST API). Tests use `hashingEmbedder()` and scripted chat models, never the network.
- Code navigation: `code.service.ts` serves files and `getReferences()` (callers/callees of the innermost symbol at a line) and `getImpact()` (breadth-first backwards over resolved calls in `analysis/impact.ts`: dependents, routes with a shortest chain, tests; the web Impact tab); the web ⌘K palette is `components/command-palette.tsx` (file matching in `lib/search.ts`, code via full-text search only, so typing never spends embedding quota). Full-text search boosts chunks whose symbol name equals a query word (`retrieval/fulltext.ts`).
- Access to snapshot data goes through `findVisibleSnapshot()` in `src/services/snapshot-access.ts`: tracked by the viewer, or listed in `DEMO_REPOSITORIES`. Routes that demo visitors may use take `app.identify` (optional auth) and `viewerId(request)`.
- Without `GEMINI_API_KEY`, indexing still works (full-text search only) and chat answers 503.
- Analysis: `src/analysis/` (components, integrations, architecture; pure functions) with `architecture.service.ts` (computed on first request, cached in `snapshot_analyses`; bump `ARCHITECTURE_VERSION` when the analysis changes) `trace.service.ts` (BFS over resolved calls from a route handler) and `guide.service.ts` (stack, start-here files and key flows from `analysis/stack.ts` and `analysis/guide.ts`, plus the AI summary; bump `GUIDE_VERSION`/`SUMMARY_VERSION` when they change). `insights.service.ts` computes hotspots, test reach and import cycles (`analysis/insights.ts`, iterative Tarjan); bump `INSIGHTS_VERSION` when it changes.
- Evaluation: runner in `src/eval/` (`metrics.ts`, `dataset.ts`, `runner.ts`, `cli.ts`), datasets in `eval/datasets/`, committed runs in `eval/results/` (imported into `eval_runs` at API startup; `/eval` shows the latest). The free Gemini tier rate-limits bulk embedding, so the runner embeds with `embedMissingChunks` (resumable). Never hand-edit result files or tune retrievers on individual questions.
- Without `GITHUB_TOKEN`, GitHub allows 60 API requests/hour per IP. For local testing, pass one in the environment rather than writing it to `.env`, e.g. `GITHUB_TOKEN=$(gh auth token) npm run dev`.

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
