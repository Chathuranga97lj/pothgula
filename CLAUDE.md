# Pothgula — Library Management System

Web-based, multi-branch library management system. **Status: in development — Phase 1 ("the counter works"), milestones M0–M8.**

- Designer / owner: Chathuranga Jayawardhana (Software Engineer). He reviews and squash-merges every PR; work happens on `feat/mN-…` branches, never directly on `main`.
- Baseline design: `docs/requirements-v3.1.html` (SRS v3.1, 2026-11-06; PDF alongside). Source of truth for scope; anything not in it is out of scope until the client approves it. It awaits the client's signature: the Q2 reading (per-branch lost-book tariff) and the unfinished Q3 note may still change, and both affect Phase 2 only. Older versions (`requirements.html`, `-v2`, `-v3`) are history; `docs/issues.txt` is the client's raw notes (kept local and gitignored — never commit it to the public repo).
- Stack (accepted; `docs/tech-stack-decision.html`): PostgreSQL 17, Node 24 LTS, NestJS 12 (ESM-only package; the API app itself compiles to CommonJS like Nest's starter), Drizzle ORM, Zod 4, React 19 + Vite 8 + Tailwind 4, react-i18next, Vitest 5, TypeScript 6.0, pnpm 10 workspaces, Docker Compose. Deliberate change from the record: sign-in uses opaque DB-backed session tokens in `Authorization: Bearer`, not JWTs (FR-AUT-07/10 need server-side revocation).

## Commands

```sh
pnpm install && pnpm build:shared   # API and web import the built shared package
pnpm db:up                          # dev Postgres on localhost:5433 (infra/compose.dev.yml)
pnpm --filter @pothgula/api db:migrate && pnpm --filter @pothgula/api db:seed
pnpm --filter @pothgula/api db:generate -- --name <what>   # after editing src/db/schema.ts
pnpm --filter @pothgula/api create-super-admin --name "…" --phone 07…   # first super admin (server only)
pnpm dev                            # API :3000 (/api prefix), web :5173 proxying /api
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # what CI runs (DB tests need Docker)
pnpm e2e                            # build, then Playwright on a throwaway pothgula_e2e database (needs pnpm db:up;
                                    # once: pnpm --filter @pothgula/e2e exec playwright install chromium)
cd infra && docker compose up -d --build   # production: API, Caddy-served web, Postgres, nightly backup (docs/setup.md)
```

Database rules live in the database: column checks and partial unique indexes in `apps/api/src/db/schema.ts`; triggers (append-only log, no deletes, fixed codes) and the `copy_availability` view in hand-written `apps/api/drizzle/0001_rules.sql`. Every data change goes through `UnitOfWork.run(actor, (tx, log) => …)`, which refuses to commit without an activity-log entry. Integration tests clone a migrated template database per file (`apps/api/test/db.ts`); HTTP tests use `startApp()` in `apps/api/test/app.ts`.

API conventions: every route needs a session unless marked `@Public()`; restrict with `@Roles(...)` and check branch scope in the service. Read the caller with `@Auth() ctx` and pass `ctx.actor` to `UnitOfWork`. Validate bodies with `parseBody(sharedSchema, body)`. Throw `AppError` with a stable `code` (the web app translates codes). Never put `password_hash` or a temporary password in a log entry — use `loggableUser()`. Map database refusals to codes with `isPgError(err, PG.uniqueViolation, 'constraint_name')`.

Lending: `apps/api/src/circulation`. Reasons a copy cannot be issued are the shared `ISSUE_REFUSALS` codes, decided in one pure function (`issue-rules.ts`); `POST /api/loans/check` lists them all without writing, and `POST /api/loans` re-checks under row locks and refuses with the first as its error code (all of them in `details.refusals`). Back-dated paper entries go through the same endpoints with a date, up to `BACKDATE_MAX_DAYS`. Extensions (FR-CIR-10–13) live on the loan row (`borrow.extension_*`, one per loan) and are decided by `extension-rules.ts` (`EXTENSION_REFUSALS`): members `POST /api/me/loans/:id/extension[/cancel]`, staff `GET /api/extensions`, `POST /api/loans/:id/extension[/approve|/decline]`. A request waiting protects the loan: pass `extensionStatus` to the shared `isOverdue`/`daysLate`/`loanStanding`, and add `notProtectedByRequest` to any SQL that decides overdue or late.

Books from other branches (§8): `apps/api/src/requests`. One `book_request` row per request, through the shared `REQUEST_STATUSES` (requested → accepted → in_transit → held → issued → returning → completed, or declined / cancelled / lapsed / lost_in_transit); a check constraint keeps each status's columns consistent, and partial unique indexes allow one open request per member and one per copy. The `copy_availability` view derives `in_transit` and `held` from it (`drizzle/0007_requests.sql`). Member: `POST /api/me/requests`, `GET /api/me/requests`, `/:id/cancel`. Staff: `GET /api/requests` (the per-branch board, which the staff panel counts), `GET /api/requests/:id` (member in full, for either branch), `/:id/accept|decline|arrive|lost`, `POST /api/requests/dispatch` (many at once, out or home) and `GET /api/requests/slip?ids=` (transit slip PDF). Issuing a held copy at the counter turns its request into the loan; taking it back starts it home (`circulation.service.ts`). Open requests count toward the book limit (`issueRefusals` `openRequests`). Uncollected holds lapse in the jobs (`requests/lapse.ts`).

Dashboards and lists: `apps/api/src/dashboard`. Alerts are worked out from live data on each request (FR-NOT-10), never stored: `GET /api/dashboard` (staff counts and panel per branch), `GET /api/due` (overdue, five-day and late-today lists), `GET /api/me/dashboard` (a member's panel, ordered in `member-panel.ts`), and the printed sheets under `/api/sheets/*` (PDF, one branch each). Panel kinds and their order are the shared `STAFF_ALERTS` and `memberPanelItemSchema`; later milestones add kinds there.

Old catalogue import (FR-CAT-13): `apps/api/src/import`. `POST /api/imports/preview` reads the CSV (`csv.ts`, UTF-8 only), checks rows and groups them into titles (`rows.ts`), and finds probable duplicates with pg_trgm in a scratch table; it writes nothing. `POST /api/imports` re-reads the same file, requires a decision for every probable duplicate (`resolveDecisions`), and numbers all copies in one unit of work, keeping the old number in `copy.legacy_no`. `log()` accepts an array for bulk work. Spine labels: `POST /api/labels`.

Reading the activity log (§14): `apps/api/src/log`. `GET /api/log` takes the shared `logFilterSchema` plus a `before` cursor (newest first); admins see their branch and library-wide records (title, category, library). A new search, each export (`GET /api/log/export?format=txt|csv|pdf`) and each history tab are logged as `log.read`/`log.export`; later pages of a search already logged are not. Any table taken away as a file goes through `renderTable()` in `apps/api/src/exports` (CSV with BOM and formula guard). Entries past retention are moved to checked `.jsonl.gz` files by `archive.ts`, under the trigger's single delete exception (`drizzle/0005_log_archive.sql`, never younger than 24 months).

Reports (§15): `apps/api/src/reports`. `GET /api/reports/:kind` (kinds in shared `REPORT_KINDS`, choices in `reportQuerySchema`) returns one generic `reportSchema` table — columns with stable keys, rows with an optional measure `key` and `link`, an optional total — for one branch, or for a super admin the whole library with a column per branch. Read live with plain SQL aggregates; not logged. `/export?format=` renders the same table through `renderTable()`. The web screen (`ReportsPage.tsx`) renders any report, wording headings from `reports.columns.<key>`. Later milestones add their reports and columns here.

Images: accept uploads only through `@ImageUpload()` + `processImage()` (format read from the bytes, re-encoded, resized) + `storeImage()` inside the unit of work; serve them only from `GET /api/images/:id`. Money: convert typed amounts with `parseRupees()` / `formatRupees()` from shared — never `parseFloat` × 100. The library name and logo live in the single-row `library` table, not on branches.

Web conventions: call the API through `api(path, { schema })` in `apps/web/src/api/client.ts` (adds the bearer token, parses with the shared schema, throws `ApiError` with the API's code); show failures with `errorMessage(t, err)`, which translates `errors.<code>`. Every visible string lives in `src/locales/en.json` and `si.json` — add both. Screens behind sign-in sit under `<RequireAuth>`; role-limited ones also under `<RequireRole>` (the API enforces the same rule). UI building blocks are in `src/components/ui.tsx`. Screen tests render the whole app with `renderApp(path)` against `fakeApi({...})`. Browser tests (`e2e/`, Playwright) run the built API and web app on a database that `apps/api/test/e2e-prepare.ts` recreates each run (fixed accounts and an overdue loan; keep `e2e/fixtures.ts` in step); they are a CI job of their own, not part of `pnpm test`.

Layout: `apps/api` (NestJS), `apps/web` (React), `packages/shared` (Zod schemas, `parseAccession`/`formatAccession`, `todayColombo`/`addDays`), `e2e/` (Playwright), `infra/` (production compose, Dockerfiles, Caddyfile, `backup/` scripts), `docs/` (`setup.md` is the installation guide).

## Domain vocabulary

| Term              | Meaning                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch            | One physical library location with a fixed two-letter code (`KS`). Every book copy and every member belongs to one home branch.                                                                                    |
| Category          | A book category with a fixed letter+digit code (`A1`) and a readable name.                                                                                                                                         |
| Accession number  | Human-readable id printed on a physical copy, format `KS-A1-01234` (branch code, category code, five-digit running number per branch+category). Immutable once allocated.                                          |
| Member            | `user_type = member` — borrows books at their home branch only. Self-registration creates a _pending_ application; staff approve it and the one-year membership runs from approval. Renewed by an annual fee.      |
| Applicant         | A pending member: can sign in and browse everything, cannot borrow, request or extend.                                                                                                                             |
| Admin (Librarian) | Branch-scoped staff: approve members, issue/return, extensions, requests, notices, open hours, payments, the branch lost-book tariff.                                                                              |
| Super admin       | Organisation-wide staff: everything an admin can do at any branch, plus branches, codes, logos, categories, staff, the annual fee, waivers, voiding loans, merging titles and lifting suspensions. Nobody deletes. |
| Issue / Take back | Lending a copy to a member / receiving it back. Loan period 2 weeks; one 2-week extension per loan on request, approved by staff, counted from the original due date.                                              |
| Request           | A member asking for a copy shelved at another branch; the copy travels to the home branch and back (requested → in transit → held → issued → returning).                                                           |
| Settlement        | What a member owes for a lost copy: an identical replacement or an amount set by staff, within a 100-day window; one book may be borrowed meanwhile.                                                               |

## Design decisions (v3.1)

- Roles are `member`, `admin`, `super_admin`. Super admins belong to no branch. There is **no** super admin code: the first super admin is created by a server CLI at install; super admins create all other staff. Sign-in screen has no role picker.
- Catalogue is **title + copy** (R1). Availability (shelf / loan / transit / held), days late and late-return counts are **derived, never stored** (R2).
- **Nothing is deleted**, even by super admins (R12): withdraw, void, deactivate, or anonymise (unsuccessful applicants after 90 days, including redaction of their log entries).
- Every data change, sign-in event, log read and personal-data export is logged append-only, **in the same transaction as the change** (R13 / FR-LOG-13). Ordinary reads are not logged.
- Free and open-source: no paid third-party service anywhere (NFR-11). No SMS/WhatsApp/email sending; all alerts are dashboard-only. Fonts and images are served by the app.
- Sign-in name is the WhatsApp number (string, unique among non-anonymised accounts). Application also needs DOB and the introducer's name **and phone**.
- Approval is in person: identity checked (number not stored) and first fee taken in one step; only a super admin can waive the fee.
- Max 2 books (a requested copy in transit/held counts); 1 while a lost-book settlement is open; a member holding an **overdue** book cannot borrow, request or extend; after day 100 of a settlement the member is **suspended**.
- Lost-book amount comes from the owning branch's tariff per category; changing it needs a reason. No fines for lateness.
- Staff and member due warnings both at 5 days. Exports: `.txt`, `.csv` (UTF-8 BOM) and PDF.

## Conventions

- All timestamps stored UTC; the library operates in Asia/Colombo (UTC+5:30). Render in local time. Due dates and windows are computed by date, not hour.
- Phone numbers are strings (Sri Lankan mobiles have a leading `0`), never numeric.
- Money is stored in cents/integer LKR, never float.
