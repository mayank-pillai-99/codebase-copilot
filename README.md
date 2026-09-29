# Codebase Copilot

**Paste a GitHub URL, get an onboarding guide to that codebase, grounded in the actual code.**

> 🚧 **Status: in development.** Working today: add a public GitHub repository and it's indexed into a code graph and a hybrid search index; browse the code with syntax highlighting; ask questions in a streaming chat whose citations link to the exact lines. Demo repositories can be explored without an account. The architecture map, request tracing, issue locator, onboarding guide and evaluation page are planned. See the [milestones](docs/SPEC.md#21-milestones).

## What it will do

- **Onboarding guide.** Covers purpose, tech stack, architecture, key request flows, and where to start reading, all generated per commit.
- **Grounded chat.** Ask "how does auth work?" and get an answer where every claim cites `file.ts:42-87` at the indexed commit.
- **Architecture map.** Built from the real import graph and detected routes; the LLM only names and describes components.
- **Request tracing.** Answers "What happens when I call `POST /api/payments`?" by walking the call graph.
- **Issue locator.** An ML model, trained on real GitHub issue→PR data, ranks the files an issue most likely involves.
- **Public evaluation.** Embedding RAG vs hybrid search vs agentic tool-use retrieval, measured on a pinned benchmark.

## Tech stack

Next.js · React · TypeScript · Tailwind · Fastify · Prisma · PostgreSQL + pgvector · Redis (BullMQ) · LangChain.js · tree-sitter · Python (model training) · Docker

## Running locally

Requires Node.js 22+ and Docker.

```bash
cp .env.example .env
npm install
npm run infra:up        # Postgres + pgvector (host port 5433) and Redis
npm run db:migrate
npm run dev             # web → http://localhost:3000, API → http://localhost:4000, plus the indexing worker
```

Sign up, then add a repository on the Repositories page. Setting `GITHUB_TOKEN` in `.env` raises GitHub's API limit from 60 to 5,000 requests per hour.

To run the whole stack in containers instead: `docker compose --profile app up --build`.

## Repository layout

```text
apps/web          Next.js frontend (proxies /api/* to the API)
apps/api          Fastify API, Prisma schema and migrations
packages/shared   Types and zod schemas shared by web and API
docs/             Specification and architecture decision records
```

## Documentation

- [Project specification](docs/SPEC.md)
- [Architecture decisions](docs/decisions/)
- [Deploying on free tiers](docs/deployment.md)
