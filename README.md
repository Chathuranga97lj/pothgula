# Pothgula

A free and open-source web system for lending and membership in a small library operating across several branches: one shared catalogue, loans and due dates, membership applications and fees, requests between branches, lost-book settlements, and a permanent activity log.

The requirements are in [`docs/requirements-v3.1.html`](docs/requirements-v3.1.html) (PDF: [`docs/Pothgula-Requirements-v3.1.pdf`](docs/Pothgula-Requirements-v3.1.pdf)); the technology choices and their reasons are in [`docs/tech-stack-decision.html`](docs/tech-stack-decision.html).

> **Status:** in development — Phase 1 ("the counter works"). Not yet ready for real library data.

## Stack

| Piece     | Choice                                                         |
| --------- | -------------------------------------------------------------- |
| Database  | PostgreSQL 17                                                  |
| API       | Node 24, NestJS 12, Drizzle ORM                                |
| Web       | React 19, Vite 8, Tailwind CSS 4, react-i18next                |
| Shared    | Zod schemas and rules in `packages/shared`, used by both sides |
| Packaging | Docker Compose                                                 |

Nothing in the system depends on a paid service (requirement NFR-11): no SMS, email or WhatsApp gateway, no CDN for fonts, no outside image hosting.

## Repository layout

```
apps/api         NestJS API
apps/web         React front end (builds to static files)
packages/shared  Zod schemas, accession-number and date rules
infra/           Compose files, and later backup/restore scripts and the setup guide
docs/            Requirements and design records
```

## Getting started

You need Node 24 (see `.node-version`), pnpm 10 and Docker.

```sh
pnpm install
pnpm build:shared      # the API and web app import the built shared package
pnpm db:up             # PostgreSQL 17 for development, on localhost:5433
pnpm --filter @pothgula/api db:migrate
pnpm --filter @pothgula/api db:seed   # invented demonstration data
pnpm dev               # API on :3000, web on :5173 (proxies /api to the API)
```

The development database listens on **5433**, not 5432, so it does not collide with a PostgreSQL already installed on the machine. Set `POTHGULA_DB_PORT` to change it, and `DATABASE_URL` to point the API elsewhere.

The API's database tests (`*.db.test.ts`) start their own PostgreSQL 17 container with Testcontainers, so Docker must be running for `pnpm test`. `pnpm --filter @pothgula/api test:unit` runs only the tests that need no database.

Checks run in CI on every pull request:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Licence

[MIT](LICENSE).
