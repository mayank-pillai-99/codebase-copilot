# Build context: repository root (see docker-compose.yml).
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @codebase-copilot/api --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run db:generate --workspace @codebase-copilot/api \
 && npm run build --workspace @codebase-copilot/api \
 && npm prune --omit=dev --workspace @codebase-copilot/api --include-workspace-root

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Free hosting has no separate release step, so apply pending migrations on boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
