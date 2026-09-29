# Build context: repository root (see docker-compose.yml). Production hosting is Vercel;
# this image exists for the full-stack `docker compose --profile app up` workflow.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @codebase-copilot/web --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Rewrites are resolved at build time, so the API location is a build argument.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm run build --workspace @codebase-copilot/web

FROM node:22-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
