# CeyLiving

A marketplace connecting Sri Lankan artisans and entrepreneurs with customers.

Marketplace for independent Sri Lankan makers: the public storefront (build spec T08) plus accounts, seller shops, items, orders, verified reviews, questions and admin moderation (feature spec `CeyLiving_Feature_Spec.docx`, tasks C01–C13). Data lives in PostgreSQL (Prisma 7).

## Run it

Needs Node 22 (`.nvmrc`; `engines` in `package.json`) and Docker Desktop (running).

```bash
npm install
npm run setup
npm run dev
```

Open http://localhost:3000 and pick a demo account on `/signin`. `npm run setup` creates `.env.local`, starts PostgreSQL and Mailpit in Docker, applies the migrations, installs the job queue and loads the demo data (`prisma/seed-data.ts`). `npm run dev` starts the site and the background worker together (see **Background jobs**). Run `npm run db:reset` to start again from the demo data.

| Command                                                                 | What it does                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup`                                                         | From a clean clone to a working site: checks Node, creates `.env.local`, starts Docker services, migrates and loads the demo data. Safe to run again. |
| `npm run dev`                                                           | Starts Next.js in development and the background worker beside it (lines prefixed `[web]` and `[worker]`). Ctrl+C stops both.                         |
| `npm run dev:web`                                                       | Next.js only, without the worker (jobs wait in the queue until a worker runs).                                                                        |
| `npm run worker`                                                        | The background worker only, as production runs it.                                                                                                    |
| `npm run jobs:migrate`                                                  | Installs or upgrades the job queue's tables (schema `pgboss`) and creates its queues, as `ceyliving_migrator`. Safe to run again.                     |
| `npm run check`                                                         | Format check + lint + typecheck + tests (Docker must be running). Run it before every commit; CI runs the same command.                               |
| `npm run format`                                                        | Formats every file with Prettier (`.prettierrc.json`, 120 columns).                                                                                   |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | The parts of `check` on their own.                                                                                                                    |
| `npm run build` / `npm start`                                           | Production build and start.                                                                                                                           |
| `npm run db:up` / `npm run db:down`                                     | Starts / stops the local PostgreSQL and Mailpit in Docker (`infra/docker-compose.dev.yml`). See **Database** below.                                   |
| `npm run db:migrate`                                                    | Applies new migrations to the local database (`prisma migrate dev`, as `ceyliving_migrator`).                                                         |
| `npm run db:generate`                                                   | Regenerates the Prisma client in `lib/server/db/generated/` (git-ignored). `npm install` runs it too.                                                 |
| `npm run db:seed` / `npm run db:reset`                                  | Replaces the local data with the demo data / drops the local database, migrates it, installs the job queue and loads the demo data again.             |

A pre-commit hook (Husky + lint-staged) runs Prettier and `eslint --fix` on staged files. `.editorconfig` and `.gitattributes` keep indentation and LF line endings the same on every OS.

## Environment variables

`lib/env.ts` checks every variable with zod when the server starts (`instrumentation.ts`). A missing or malformed value stops the app with a message naming the key (never the value). `.env.example` lists every key; put real values in `.env.local` (git-ignored). Empty values count as not set.

| Variable                 | Values                                                | Purpose                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `development`, `test`, `production`                   | Set by Next.js and Vitest. Don't set it in `.env` files.                                                                                                                      |
| `ENABLE_DEMO_LOGIN`      | `true` / `false` (default `false`)                    | Demo sign-in, development only (AU-09). `npm run setup` puts it in `.env.development.local`, which only `next dev` reads. The app refuses to start with `true` in production. |
| `LOG_LEVEL`              | `fatal` … `trace`, `silent`                           | Log level (OPS-01). Default `info`, or `silent` under tests.                                                                                                                  |
| `SITE_URL`               | `https://…` address (default `http://localhost:3000`) | The site's public address for `sitemap.xml` and `robots.txt`. Must be `https://` in production, except on localhost.                                                          |
| `DATABASE_URL`           | `postgresql://` address                               | PostgreSQL as `ceyliving_app`, the data-only user (DB-10). Required in production; `npm run setup` sets the local one.                                                        |
| `DATABASE_MIGRATION_URL` | `postgresql://` address                               | PostgreSQL as `ceyliving_migrator`, the schema owner. Only migrations, `npm run jobs:migrate` and the seed use it (`prisma.config.ts` also reads `.env.local`).               |
| `WORKER_CONCURRENCY`     | 1 to 20 (default 2)                                   | How many jobs of one queue the worker runs at the same time (B06).                                                                                                            |
| `BETTER_AUTH_SECRET`     | 32+ random characters                                 | Signs session cookies and email links (AU-03). Required in production; `npm run setup` writes a random local one.                                                             |
| `SMTP_URL`               | `smtp://` or `smtps://` address                       | Where sign-in emails go. Required in production. Locally `smtp://127.0.0.1:1025` is Mailpit (read them at http://localhost:8025).                                             |
| `EMAIL_FROM`             | sender                                                | Default `CeyLiving <no-reply@ceyliving.lk>`.                                                                                                                                  |
| `TURNSTILE_SITE_KEY`     | Cloudflare Turnstile site key                         | The "are you a person" check (AU-06). Required in production. Unset in development and tests, Cloudflare's published test keys are used; production refuses them.             |
| `TURNSTILE_SECRET_KEY`   | Cloudflare Turnstile secret key                       | Used only on the server, to ask Cloudflare whether a token is valid. Same rules as the site key.                                                                              |

## Database

PostgreSQL 17 with Prisma 7 (`prisma/schema.prisma`, migrations in `prisma/migrations/`). Decision record: `docs/adr/0001-schema-grows-per-task.md`.

`npm run setup` does all of this. PostgreSQL listens on `localhost:15432` (so it never clashes with an installed one) and Mailpit's inbox on http://localhost:8025. Both bind to 127.0.0.1 only. After changing `prisma/schema.prisma`, `npm run db:migrate` creates and applies a migration.

- **Two database users (DB-10):** `ceyliving_migrator` owns the schema and runs migrations; `ceyliving_app` (created by `infra/postgres-init/`) can only read and write rows. The first migration grants those rights.
- **Append-only audit log (DB-09):** `ceyliving_app` may not update, delete or truncate `audit_log`.
- **In the schema, not just the code (DB-07):** CHECK constraints for limits and totals, and partial unique indexes for one open application per person (RULE-A1), one open shop per owner and one open report per reporter.
- **Code:** `lib/server/db/tx.ts` holds the handle (`db` and `withTx`, READ COMMITTED, retried up to 3 times on serialization or deadlock errors: DB-05). `lib/server/db/mappers.ts` turns rows into `lib/types.ts` objects (BE-01). ESLint keeps Prisma and the handle's internals inside `lib/server/db/` and `lib/server/repositories/`.
- **Catalogue in SQL (B04b):** filters, sorts and search run in PostgreSQL (`lib/server/repositories/catalogue-search.ts`) and results come in keyset pages: "Load more" fetches the next page from `/api/catalogue/page` and adds it below, and without JavaScript it is a link to the next page. The cursor is opaque and checked; a bad one just gives the first page. Tests compare every filter and sort with the in-memory reference in `lib/catalogue.ts`.
- **Search:** every word must match, as the start of a word, in the item (title, tags, materials, description), its shop's name or its category's English or Sinhala name. Generated `search_vector` columns with GIN indexes back it (migration `catalogue_search`), using the `simple` configuration so English and Sinhala are both indexed. Search text reaches SQL only as letters and digits in a bound parameter (BE-04). When no item matches, suggestions fall back to close spellings with `pg_trgm` ("batk" finds batik).
- **Speed (a benchmark, not a promise):** with 5,814 items on the local Docker database, each catalogue page and search took 12 to 27 ms (median), 37 ms at worst. Real hosting adds network time and will differ with the server and data size.
- **Public pages are cached:** every public read (catalogue pages, search, item, shop and category pages, makers, sitemap) is a small query cached per argument and tagged `catalogue` (`lib/server/catalogue.ts`). Every action that changes an item, a shop, a review, a question, a moderation decision or an anonymised author calls `refreshEverything()` (`lib/server/actions/refresh.ts`), which expires the tag, so the next visit reads fresh rows. Signed-in, seller and admin pages always read the database directly. Because item, shop and category pages are prerendered, `npm run build` needs a reachable, migrated and seeded database (CI starts one).
- **Errors people see:** the services check every rule first, so the database only refuses a write when two requests race. A unique clash (a second open application, a web address just taken, a repeated vote or report) becomes a `ConflictError` with a plain message (`lib/server/db/pg-errors.ts`); any other database error is logged and shown as the generic message with a reference. Raw PostgreSQL text never reaches a page.
- **Seed loader:** `lib/server/db/load-seed.ts` loads the categories and the demo data into every table in one transaction. With `{ replace: true }` it empties the tables first, so running it again never duplicates rows; it refuses to replace data in production.
- **Done so far:** B03a (people: users, applications, addresses, notifications, audit log, rate events) B03b (catalogue: shops, products; content: reviews, questions, answers, reports, helpful votes) and B03c (commerce: orders, seller orders, items, payouts, custom requests). B04a switched the app to PostgreSQL and removed the dev JSON store; its last version is kept in git as the tag `pre-b04a-dev-store`. B04b moved the catalogue, search and paging into SQL.
- **Paid out once (BR-11):** `setPayoutOnSellerOrders` links only orders with no payout yet. If two payout runs race, the second gets a `ConflictError` and rolls back, so no order is ever paid twice. A repository test runs two payouts side by side to prove it. Since B06 the admin button and the weekly job share one service, `runPayouts`, which makes each shop's payout in its own transaction and skips a shop another run has just paid; a test runs both at once.
- **B06 migration (`jobs_worker`):** adds `seller_orders.accept_deadline_at` (BR-08; NULL means no deadline, and B08 sets it at payment), indexes for the jobs' lookups, and lets `audit_log.actor_id` be NULL, meaning a scheduled job made the change. The audit pages show "CeyLiving (scheduled job)" and the reason names the job. The migration's header explains the rollback, including the one part that can't be undone once jobs have written audit rows.

## Background jobs

A second process, the worker (`worker/index.ts`, pg-boss 12), runs the jobs of backend plan 10.2 from the same code as the site: the same services, repositories and rules. The queue lives in PostgreSQL (schema `pgboss`), so there is no Redis to run. `lib/server/jobs/queues.ts` lists every job. `worker/handlers/` has one file per job: it checks the payload with zod, calls a service and returns what it did for the log (JOB-01).

| Job                           | When                            | What it does                                                                                                         |
| ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `payouts.generateWeekly`      | Mondays 06:00                   | The payout run (BR-11). The **Generate payouts** button on `/admin/payouts` runs the same service by hand.           |
| `orders.autoCancelUnaccepted` | Every 15 minutes                | NEW seller orders past their accept deadline are cancelled, and the customer and maker are told (BR-08).             |
| `orders.autoComplete`         | Hourly                          | Orders dispatched 7 days ago and still not confirmed are marked delivered (BR-17).                                   |
| `customRequests.expire`       | Hourly                          | Open requests and unanswered quotes older than 14 days expire, and the customer is told (FR-14).                     |
| `users.liftExpiredMutes`      | Hourly                          | Mutes that have run out are lifted, the person is told and the change is audited (RULE-M3).                          |
| `reports.autoHide`            | When a post gets its 3rd report | Hides the post until an admin looks (RULE-M4). Enqueued in the report's transaction, with one queued check per post. |
| `maintenance.cleanup`         | Daily 03:00                     | Deletes rate events and attempt counters over a day old, expired sessions and expired email links.                   |
| `orders.expireUnpaid`         | Per order                       | **Stub** until B07 (checkout creates unpaid orders and enqueues this for each).                                      |
| `payments.reconcile`          | Daily 02:00                     | **Stub** until B08 (PayHere payments, PAY-08).                                                                       |
| `email.send`, `image.process` | On demand                       | **Stubs** until B10 (email) and B09 (uploads). Sign-in emails still go out directly.                                 |

Times are Sri Lankan time (Asia/Colombo).

- **Created with the change (JOB-02):** `enqueue(tx, name, payload)` (`lib/server/repositories/jobs.ts`) writes the job through the business transaction's own connection, so a job exists only if that change committed.
- **Safe to run twice (JOB-03):** every job selects only rows still in their old state and changes them with a conditional update. A retry, a second worker or a person acting at the same moment never changes a row twice. Each job has a test that runs it twice.
- **Retries (JOB-04):** five tries, about 30 seconds, 1, 2 and 4 minutes apart. A job that fails its last try stays in `pgboss.job` as `failed` and is logged as `job.failed` (level error), and every admin gets a notification. A payload that fails its schema is logged as `job.invalid_payload` and alerted without retrying.
- **Schedules run once (JOB-05):** pg-boss stores schedules in the database and files each tick under one key, so a tick makes one job however many workers run. Scheduled queues also allow only one waiting and one running job.
- **Batches (JOB-06):** jobs that touch many rows take 100 at a time, each batch in its own transaction, until a batch comes back short. A crash loses only the open batch, and the next run carries on.
- **Graceful stop (JOB-07):** on SIGTERM or Ctrl+C the worker takes no new jobs and waits up to 30 seconds for running ones. A job still running then is retried later, which JOB-03 makes safe. A second signal stops at once.
- **Database rights (DB-10):** `npm run jobs:migrate` installs and upgrades the `pgboss` schema as `ceyliving_migrator` and gives `ceyliving_app` row rights only. The site and the worker connect as `ceyliving_app` and never change the queue's structure. A worker that finds the schema missing or out of date refuses to start.

**Running the worker**

- **Development:** `npm run dev` runs both processes, and the worker restarts itself when its code changes. `npm run dev:web` runs the site alone; jobs then wait in the queue and run when a worker starts.
- **Production:** run the site (`npm start`) and the worker (`npm run worker`) as two processes, each kept running and restarted if it stops (in B14 they become two containers from one image). Before starting a new version, run `npx prisma migrate deploy` and then `npm run jobs:migrate`. Stop the worker with SIGTERM (`docker stop` sends it, then waits) and give it at least 30 seconds. Restarting is safe at any time. One worker is enough at launch, and more can run side by side.
- **Watching it:** the worker logs JSON lines with `service: "ceyliving-worker"`: `worker.started`, then `job.completed` (with `job`, `jobId`, `attempt`, `durationMs` and counts), `job.retrying` and `job.failed`. Admins get a notification for every job that fails for good. To look at the queue: `SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2;` and `SELECT name, cron, timezone FROM pgboss.schedule;`. Finished and failed jobs stay there for pg-boss's retention period. The admin "Operations" card comes in B12 (OPS-07).

## Logging and request IDs

- **Logger:** `lib/server/observability/logger.ts` (Pino) writes one JSON line per event to stdout: `level`, `time`, `service`, `msg`, `requestId`, plus fields such as `route`, `status`, `durationMs` and `err` (OPS-01). For readable logs in development, run `npm run dev | npx pino-pretty`.
- **Redaction:** passwords, tokens, cookies, authorization headers, account numbers, email, phone and address fields are replaced with `[REDACTED]` up to two levels deep. Email addresses inside error messages and stacks are masked as `[EMAIL]`.
- **Request IDs (OPS-02):** `proxy.ts` runs on every request. It uses Cloudflare's `cf-ray` when it is well formed, otherwise a new UUID, and never trusts a client-sent `x-request-id`. The ID travels upstream in `x-request-id` and comes back on every response.
- **Error wrappers (OPS-03):** `runAction` (server actions) and `withRoute` (route handlers, `lib/server/observability/route.ts`) log each outcome with its duration. Unexpected errors are logged with the stack, and people see a generic message ending in `Reference: <request ID>`. Errors Next.js catches itself go through `onRequestError` in `instrumentation.ts`, which logs the request ID together with the digest that the error page shows as its reference.
- **No console:** ESLint's `no-console` rule applies to `app/`, `lib/`, `components/` and `proxy.ts`. `instrumentation.ts` keeps one `console.error` for a bad environment, because the logger needs a valid environment.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, `Feature-01` and `Feature-02`: `npm ci` → `npm run check` → `npm run build` → `npm audit` → Gitleaks secret scan. Actions are pinned by commit SHA.

**npm audit:** `npm audit --omit=dev --audit-level=high` blocks CI, so production dependencies must stay clean. The full audit runs too but only reports. It currently shows 5 high findings in dev-only dependencies (`braces` → `micromatch` → `fast-glob` → `eslint-config-next`). They are accepted for now because they run only in ESLint on developer machines and CI, never in the app, and the only offered fix is downgrading `eslint-config-next` to 14, which breaks linting for Next.js 16. Revisit when `eslint-config-next` ships a fixed version.

## Demo accounts (development only)

Go to `/signin`. With `ENABLE_DEMO_LOGIN=true` (set by `npm run setup`), a **Demo accounts** panel signs you in with one click, through a real session. It never appears in production, where the endpoint doesn't exist and the server refuses it. Demo accounts have no password, so no one can sign in to them any other way. A demo sign-in counts as two-step (B05b), so the demo seller and admin open their areas straight away; to try the two-step set-up, give an account a password with "Forgot password" and sign in with it.

| Account                                      | What to try                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Customer (Anushka)                           | Orders: one delivered and ready to review, one on its way ("I received this"), one new. Ask questions, report content, save addresses. |
| Applicant (Tharindu)                         | Application pending: see its status on `/account`.                                                                                     |
| Seller (Ruwan, Ambalangoda Mask House)       | `/seller`: accept and dispatch the new order, answer the open question, reply to reviews, add items (publish straight away).           |
| Seller, suspended (Chaminda, Pol Katu Lanka) | Shop hidden everywhere; dashboard explains why.                                                                                        |
| Admin (Dilani)                               | `/admin`: approve the application, suspend shops, review items, moderate posts, mute users, read the audit log.                        |

## Routes

| Route                                                                                                                                                                                                                                         | Who       | What                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/shop`, `/c/[slug]`, `/search`, `/p/[slug]`, `/makers`, `/shop/[slug]`, `/heritage`, `/custom`, `/about`, `/sell`, `/help`                                                                                                              | Everyone  | Storefront. Only ACTIVE items of ACTIVE shops are shown (RULE-P4, RULE-S4). Item pages carry Q&A, reviews and report buttons.                                                                              |
| `/cart`, `/checkout`, `/account/wishlist`                                                                                                                                                                                                     | Everyone  | Cart and wishlist kept in the browser; summaries come from `/api/catalogue` so hidden items drop out.                                                                                                      |
| `/signin`, `/register`, `/signin/two-step`                                                                                                                                                                                                    | Everyone  | Sign-in (password or passkey), sign-up, the code step after the password, and the demo accounts panel.                                                                                                     |
| `/account`, `/account/orders`, `/account/orders/[orderNumber]`, `/account/addresses`, `/account/questions`, `/account/requests`, `/account/notifications`                                                                                     | Signed in | Profile with role cards and privacy (FR-1, FR-17), orders and reviews (FR-6, FR-3a), addresses (FR-12), my questions, custom requests (FR-14), notifications (FR-11).                                      |
| `/account/export`                                                                                                                                                                                                                             | Signed in | Download my data as JSON (FR-17). Only the requester’s own data, never cached.                                                                                                                             |
| `/sell/apply`, `/sell/apply/submitted`                                                                                                                                                                                                        | Customers | Apply to open a shop (FR-2a): your details, the shop, the categories you plan to sell in (1 to 6) and the shop address. An admin approves or rejects it; once approved you set up the shop and post items. |
| `/seller`, `/seller/shop`, `/seller/products`, `/seller/products/new`, `/seller/products/[id]/edit`, `/seller/orders`, `/seller/orders/[id]`, `/seller/questions`, `/seller/reviews`, `/seller/requests`, `/seller/payouts`                   | Sellers   | Set-up checklist, shop profile and payout details, items, orders (BR-07), questions, review replies, custom requests, payout statements (FR-2b, FR-2c, FR-7, FR-13, FR-14, FR-18).                         |
| `/admin`, `/admin/applications`, `/admin/applications/[id]`, `/admin/sellers`, `/admin/sellers/[shopId]`, `/admin/products`, `/admin/moderation`, `/admin/reports`, `/admin/users`, `/admin/users/[id]`, `/admin/payouts`, `/admin/audit-log` | Admins    | Dashboard, applications, shops, item review, moderation, reports, users and role changes, payouts, audit log (FR-4, FR-5, FR-8 to FR-10, FR-13, FR-15, FR-16).                                             |

## How the code is organised

Requests follow the feature spec (section 7.2): **form → server action → service → repository → PostgreSQL**.

- `lib/server/actions/*` — thin server actions: who is asking (`requireActor`) → validate with zod (`lib/validation/*`) → call a service → revalidate → return `{ ok, message, fieldErrors }`.
- `lib/server/services/*` — every business rule (RULE-A, S, P, R, Q, M, N), status-flow tables and audit rows. Async functions of an actor and input that open their own transaction with `withTx` (BE-02), so they are unit-tested directly.
- `lib/server/repositories/*` — the only code that reads or writes stored rows (BE-01). Every function is async and takes a handle first: `findUserById(db, id)` for a read, `updateSellerOrder(tx, id, patch, { from })` inside a transaction. Status changes are conditional updates: they return nothing if the status changed first (DB-06).
- `lib/server/db/tx.ts` — the handle: `withTx(fn)` runs one all-or-nothing transaction (DB-04); `db` is the shared read-only handle for pages (BE-03).
- `lib/server/permissions.ts` / `auth.ts` — `requireUser`, `requireRole`, `assertShopOwner`, `canPost`.

**From the dev store to PostgreSQL (backend plan 6.2):** B02 moved all data access behind async repositories and `withTx`, B03 built PostgreSQL versions of them, and B04a switched over and deleted the dev JSON store. Services, actions and pages did not change.

## Security

- **Sign-in (B05a, Better Auth):** email and password, with the email confirmed before posting, selling or checking out (AU-01). Passwords need 10+ characters and are checked against known data breaches; Better Auth hashes them. Messages never reveal whether an email has an account (AU-07). Sessions live in PostgreSQL behind an HttpOnly, SameSite=Lax cookie (Secure in production), last 7 days idle and 30 days in all, and end on a password change or reset, a role change and account deletion; "Sign out everywhere" is on `/account` (AU-03, AU-04, AU-11). Sign-in, sign-up and reset allow 5 attempts per 15 minutes per email and per IP, counted in the database so every app instance shares them (AU-06). Emails go out over SMTP (Mailpit locally). `getSession()` returns the same `{ user }` as before (AU-05).
- **Two-step sign-in (B05b):** an authenticator app (TOTP, set up with a QR code or a typed key) or a passkey. Sellers and admins need a session opened with two steps before `/seller` or `/admin` opens; without one they go to `/account/two-step` and back (AU-02). Seller and admin actions check the same thing on the server, so calling them directly is refused too. A passkey must be unlocked with the device's PIN or biometric, so it counts as two steps alone. Ten recovery codes are shown once and stored only as keyed hashes (HMAC with `BETTER_AUTH_SECRET`); each works once. There is no "trust this device". Once an account has a second step, adding or removing one needs a session opened with two steps, so a stolen password can't add an attacker's passkey. Sellers and admins can't turn the app off. Turning two-step on (confirming the app, or adding a passkey) gives this browser a fresh session and ends every other one (AU-04).
- **Passkeys:** anyone can add one under "Sign-in and security" on `/account` and sign in with it on `/signin` (`@better-auth/passkey`, WebAuthn; only the public key is stored).
- **Turnstile (AU-06):** always on sign-up and password reset, and on sign-in after 3 failed attempts for that email or IP in 15 minutes. The token is checked with Cloudflare on the server (`lib/server/turnstile.ts`); if Cloudflare can't be reached, the check fails. Better Auth's own `/api/auth/sign-in/email`, `/sign-up/email` and `/request-password-reset` routes, called directly, always need a token.
- **Admin sessions (AU-03):** end 12 hours after sign-in, or after 2 hours without use (use is recorded at most every 15 minutes, so up to 15 minutes later).
- **Server checks:** every protected layout, page and action checks the session and role on the server (SEC-A1). Hidden buttons are never the check. `proxy.ts` is only a fast first redirect for visitors with no session.
- **Ownership:** sellers' shops are always loaded by owner, never from IDs in the form (SEC-A2). Other people's orders, items and shops return 404 (SEC-A5).
- **Input:** all input is validated with zod (SEC-A3). User text is rendered as plain text (SEC-A4). Questions, answers, reviews and replies can't contain emails, phone numbers or links (RULE-Q4).
- **Rate limits:** posting actions are rate-limited per user (SEC-A6; limits in `lib/config.ts`).
- **Admin actions:** every admin action needs a confirmation, a reason where the rules require one, and writes an append-only audit row in the same transaction (SEC-A9).
- **Server-only code:** server modules start with `import "server-only"` (SEC-A7). Demo sign-in is impossible in production, and tests prove it (SEC-A8).
- **Buyer details:** sellers see a buyer's name, address and phone only for their own orders, and only until 30 days after delivery (SEC-A10).
- **Response headers:** Content-Security-Policy, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy are set in `next.config.ts`.
  - The CSP allows `'unsafe-inline'` scripts because nonces are incompatible with Partial Prerendering.
  - Images are limited to the Unsplash CDN, and photo links are validated to that host.
- **Errors:** unexpected errors are logged on the server and shown to people as a generic message with a reference ID (CS-14, OPS-02).

**Also included:**

- **Helpful votes:** reviews and questions can be voted helpful, and are sorted most helpful first (FR-19).
- **Payouts:** the weekly payout job (BR-11) runs in the worker on Mondays, and the button on `/admin/payouts` still runs it by hand.
- **Account deletion:** deleting an account anonymises it and keeps order records (FR-17).

**Not production-ready yet:** PayHere payments and file uploads are still required before launch.

## Tests

`npm test` runs every test against PostgreSQL. Docker must be running: a Vitest global setup (`test/global-setup.ts`) starts one throwaway PostgreSQL with Testcontainers, applies the real migrations and installs the job queue, each test file gets its own copy of that database, and the demo data is loaded again before every test (`test/db.ts`). Without Docker the run stops with a clear message instead of skipping database tests.

- **Unit tests:** every business rule, named with its ID (for example `RULE-R1 blocks a review without a delivered order`).
- **Permission tests:** every server action is called as a guest, plus wrong-role and other-owner cases.
- **Sign-in (`lib/server/auth-flows.test.ts`):** sign up, confirm by email, sign in; same answers for unknown emails; breached passwords refused; one-time reset links; sessions ended on reset, password change, role change and deletion; the 30-day limit; attempt limits shared across instances; a customer with a real session calling admin and seller actions directly is refused and nothing changes.
- **Two-step, passkeys, Turnstile (`lib/server/two-step.test.ts`):** sellers and admins without two-step are sent to set it up and their actions are refused; TOTP set-up and sign-in; other sessions ended on set-up; recovery codes stored hashed and single-use; Turnstile refused without a valid token, checked on the server (Cloudflare stubbed, never called); admin session limits.
- **Production guards:** demo sign-in is impossible in production, and an old or forged demo cookie signs no one in.
- **Repositories (`test/repositories/`):** each repository against PostgreSQL, plus what only the database enforces: DB-05 retries, DB-07 constraints, DB-09 and DB-10 rights, one payout per order, and a seed loader that can run twice.
- **Caching:** actions that change public data expire the catalogue cache, and failed ones don't (B04a).
- **Transactions:** a failed step writes nothing (DB-04), a status that changed first gives a clear conflict (DB-06), and the shared read handle refuses writes (BE-03).
- **Environment:** `lib/env.ts` refuses demo login in production (AU-09), requires real Turnstile keys there (AU-06) and names bad keys without echoing values.
- **Logging (OPS-01 to OPS-03):** redaction of secrets and personal data, request-ID rules, the proxy's header and redirects, and the `runAction` and `withRoute` references.
- **Header components:** the header's sign-in states and menus.
- **Background jobs (`worker/jobs.test.ts`, `worker/worker.test.ts`):** every job run twice (JOB-03) with its rule (BR-08, BR-11, BR-17, FR-14, RULE-M3, RULE-M4); the admin payout button and the weekly job at the same moment pay each order once; 250 rows handled in batches of 100 (JOB-06); a job enqueued in a rolled-back transaction never exists (JOB-02). With real pg-boss workers: two workers run one schedule tick once (JOB-05), a failing job is retried and then alerts the admins (JOB-04), and stopping waits for a running job, up to its time limit (JOB-07).
- **Full journey:** apply → approve → set up → post → approve item → buy → deliver → review → ask → answer → report → hide.

## Design: Lacquer & Loom

Colours come from Laksha lacquerware and structure from Dumbara weaving.

- **Tokens:** defined in `app/globals.css`. Components use tokens only.
- **Type:** Young Serif and Hanken Grotesk, with Noto Sans Sinhala for Sinhala words.
- **Craft labels:** traditional crafts sit under an arch and carry the lacquer band.
- **Motion:** one orchestrated load moment (the home hero); everything else responds to the person. `prefers-reduced-motion` turns it all off.

## Images

Product and maker photos are free Unsplash images loaded through their CDN (`lib/image-loader.ts`). Shop names, people and stories are illustrative.
