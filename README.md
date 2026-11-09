# Pothgula

A free and open-source web system for lending and membership in a small library operating across several branches: one shared catalogue, loans and due dates, membership applications and fees, requests between branches, lost-book settlements, and a permanent activity log.

The requirements are in [`docs/requirements-v3.1.html`](docs/requirements-v3.1.html) (PDF: [`docs/Pothgula-Requirements-v3.1.pdf`](docs/Pothgula-Requirements-v3.1.pdf)); the technology choices and their reasons are in [`docs/tech-stack-decision.html`](docs/tech-stack-decision.html).

> **Status:** Phase 1 ("the counter works") is complete as v0.1.0, awaiting the library's review. To install it, see [`docs/setup.md`](docs/setup.md).

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
infra/           Production setup (compose.yml, Caddyfile, Dockerfiles), backup and restore scripts
e2e/             Playwright browser tests
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

To sign in, create the first super admin (FR-AUT-04). This is done on the server, never through the website, and only once:

```sh
pnpm --filter @pothgula/api create-super-admin --name "Your Name" --phone 07XXXXXXXX
```

It prints a temporary password that must be changed at the first sign-in. If every super admin is locked out, `pnpm --filter @pothgula/api reset-super-admin --phone 07XXXXXXXX` issues a new temporary password; both commands are written to the activity log.

The development database listens on **5433**, not 5432, so it does not collide with a PostgreSQL already installed on the machine. Set `POTHGULA_DB_PORT` to change it, and `DATABASE_URL` to point the API elsewhere.

The API's database tests (`*.db.test.ts`) start their own PostgreSQL 17 container with Testcontainers, so Docker must be running for `pnpm test`. `pnpm --filter @pothgula/api test:unit` runs only the tests that need no database.

Checks run in CI on every pull request:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e    # Playwright, on a throwaway database (needs pnpm db:up)
```

CI also installs the production setup from `infra/compose.yml` on a clean machine and rehearses a backup and restore.

## Installing for a library

[`docs/setup.md`](docs/setup.md): one setup file, free HTTPS, nightly backups kept 30 days, a weekly copy to a library computer, and the restore rehearsal.

## Licence

[MIT](LICENSE).
