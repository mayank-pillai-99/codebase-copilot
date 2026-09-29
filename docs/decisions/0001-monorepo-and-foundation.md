# 0001: Monorepo and foundation tooling

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Milestone 1 needs a structure for a Next.js frontend, a Fastify API (and later a worker) and shared types. It must be simple to explain, cheap to run on free hosting, and fast to iterate on.

## Decision

- **npm workspaces** (`apps/*`, `packages/*`) with no Turborepo or Nx. There are only three packages, so an orchestrator would add more moving parts than it saves.
- **`packages/shared` ships TypeScript source**, with no build step of its own. The API bundles it with tsup (`noExternal`), and Next.js compiles it through `transpilePackages`. Shared zod schemas are the API contract: the API emits the shapes, and the web app validates responses against them.
- **Fastify 5 + zod** for the API. It's fast and typed, it has built-in pino logging, and it supports plugins without a framework's worth of abstractions. Dependencies such as DB and Redis checks are injected into `buildApp()`, so route tests run without infrastructure.
- **Prisma 7** with the `prisma-client` generator and the `@prisma/adapter-pg` driver adapter. The client is generated into `src/generated/` (gitignored). The pgvector extension is enabled in a hand-written migration, because Prisma doesn't manage extensions by default, and a drift check confirms the schema and database agree.
- **Pinned versions:** TypeScript `~6.0` (typescript-eslint doesn't support TS 7 yet) and Prisma `7.10.0` (npm's `latest` tag currently points to an 8.0 release candidate).
- **Next.js rewrites** proxy `/api/*` to the API, so the browser only ever sees one origin. That makes the httpOnly auth cookie in M2 work even though the web app and API are hosted separately.
- **Migrations run when the API container starts** (`prisma migrate deploy && node dist/server.js`), because free hosting has no separate release step. This is why `prisma` and `dotenv` are production dependencies of the API.
- **Docker Compose** runs Postgres (pgvector image, host port 5433 so it doesn't clash with a local Postgres) and Redis by default. The `app` profile adds the API and web containers.

## Consequences

- One `npm install` sets everything up, and CI runs lint, format, typecheck, migrations, unit + integration tests, and build against real Postgres and Redis service containers.
- The API image is large (~850 MB), mostly the Prisma CLI and its engines. Trim it before deploying (e.g. a separate migration step or a slimmer runtime install) if the host's limits require.
- `npm audit` currently reports advisories in Prisma CLI transitive dependencies (`mysql2`, `deepmerge-ts`) and esbuild's dev server. None of them run in the API at runtime. Re-check when Prisma 8 is stable.
