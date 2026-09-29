# Codebase Copilot

**Paste a GitHub URL, get an onboarding guide to that codebase, grounded in the actual code.**

> 🚧 **Status: in development.** This repository currently contains the specification. Features below are planned, not yet built.

## What it will do

- **Onboarding guide.** Covers purpose, tech stack, architecture, key request flows, and where to start reading, all generated per commit.
- **Grounded chat.** Ask "how does auth work?" and get an answer where every claim cites `file.ts:42-87` at the indexed commit.
- **Architecture map.** Built from the real import graph and detected routes; the LLM only names and describes components.
- **Request tracing.** Answers "What happens when I call `POST /api/payments`?" by walking the call graph.
- **Issue locator.** An ML model, trained on real GitHub issue→PR data, ranks the files an issue most likely involves.
- **Public evaluation.** Embedding RAG vs hybrid search vs agentic tool-use retrieval, measured on a pinned benchmark.

## Tech stack

Next.js · React · TypeScript · Tailwind · Fastify · Prisma · PostgreSQL + pgvector · Redis (BullMQ) · LangChain.js · tree-sitter · Python (model training) · Docker

## Documentation

- [Project specification](docs/SPEC.md)
