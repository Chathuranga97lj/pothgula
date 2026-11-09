# The web app, served by Caddy, which also passes /api to the API container and
# obtains a free HTTPS certificate for a real domain. Built from the repository root:
#   docker build -f infra/web.Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @pothgula/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @pothgula/shared build && pnpm --filter @pothgula/web build

FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
