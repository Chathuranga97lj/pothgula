# The Pothgula API. Built from the repository root:
#   docker build -f infra/api.Dockerfile .
# On start it applies any new database migrations, then serves on port 3000.

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @pothgula/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @pothgula/shared build \
 && pnpm --filter @pothgula/api build \
 && pnpm --filter @pothgula/api deploy --prod --legacy /out

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["sh", "-c", "node dist/cli/migrate.js && exec node dist/main.js"]
