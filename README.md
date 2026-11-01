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

Open http://localhost:3000 and pick a demo account on `/signin`. `npm run setup` creates `.env.local`, starts PostgreSQL and Mailpit in Docker, applies the migrations and loads the demo data (`prisma/seed-data.ts`). Run `npm run db:reset` to start again from the demo data.

| Command                                                                 | What it does                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup`                                                         | From a clean clone to a working site: checks Node, creates `.env.local`, starts Docker services, migrates and loads the demo data. Safe to run again. |
| `npm run dev`                                                           | Starts Next.js in development.                                                                                                                        |
| `npm run check`                                                         | Format check + lint + typecheck + tests (Docker must be running). Run it before every commit; CI runs the same command.                               |
| `npm run format`                                                        | Formats every file with Prettier (`.prettierrc.json`, 120 columns).                                                                                   |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | The parts of `check` on their own.                                                                                                                    |
| `npm run build` / `npm start`                                           | Production build and start.                                                                                                                           |
| `npm run db:up` / `npm run db:down`                                     | Starts / stops the local PostgreSQL and Mailpit in Docker (`infra/docker-compose.dev.yml`). See **Database** below.                                   |
| `npm run db:migrate`                                                    | Applies new migrations to the local database (`prisma migrate dev`, as `ceyliving_migrator`).                                                         |
| `npm run db:generate`                                                   | Regenerates the Prisma client in `lib/server/db/generated/` (git-ignored). `npm install` runs it too.                                                 |
| `npm run db:seed` / `npm run db:reset`                                  | Replaces the local data with the demo data / drops the local database, migrates it and loads the demo data again.                                     |

A pre-commit hook (Husky + lint-staged) runs Prettier and `eslint --fix` on staged files. `.editorconfig` and `.gitattributes` keep indentation and LF line endings the same on every OS.

## Environment variables

`lib/env.ts` checks every variable with zod when the server starts (`instrumentation.ts`). A missing or malformed value stops the app with a message naming the key (never the value). `.env.example` lists every key; put real values in `.env.local` (git-ignored). Empty values count as not set.

| Variable                 | Values                                                | Purpose                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`               | `development`, `test`, `production`                   | Set by Next.js and Vitest. Don't set it in `.env` files.                                                                                                                                   |
| `ENABLE_DEMO_LOGIN`      | `true` / `false` (default `false`)                    | Demo sign-in, development only (AU-09). The app refuses to start with `true` in production. For now it is only validated; the demo panel still follows `NODE_ENV` until Better Auth (B05). |
| `LOG_LEVEL`              | `fatal` … `trace`, `silent`                           | Log level (OPS-01). Default `info`, or `silent` under tests.                                                                                                                               |
| `SITE_URL`               | `https://…` address (default `http://localhost:3000`) | The site's public address for `sitemap.xml` and `robots.txt`. Must be `https://` in production, except on localhost.                                                                       |
| `DATABASE_URL`           | `postgresql://` address                               | PostgreSQL as `ceyliving_app`, the data-only user (DB-10). Required in production; `npm run setup` sets the local one.                                                                     |
| `DATABASE_MIGRATION_URL` | `postgresql://` address                               | PostgreSQL as `ceyliving_migrator`, the schema owner. Only migrations and the seed use it (`prisma.config.ts` also reads `.env.local`).                                                    |

## Database

PostgreSQL 17 with Prisma 7 (`prisma/schema.prisma`, migrations in `prisma/migrations/`). Decision record: `docs/adr/0001-schema-grows-per-task.md`.

`npm run setup` does all of this. PostgreSQL listens on `localhost:15432` (so it never clashes with an installed one) and Mailpit's inbox on http://localhost:8025. Both bind to 127.0.0.1 only. After changing `prisma/schema.prisma`, `npm run db:migrate` creates and applies a migration.

- **Two database users (DB-10):** `ceyliving_migrator` owns the schema and runs migrations; `ceyliving_app` (created by `infra/postgres-init/`) can only read and write rows. The first migration grants those rights.
- **Append-only audit log (DB-09):** `ceyliving_app` may not update, delete or truncate `audit_log`.
- **In the schema, not just the code (DB-07):** CHECK constraints for limits and totals, and partial unique indexes for one open application per person (RULE-A1), one open shop per owner and one open report per reporter.
- **Code:** `lib/server/db/tx.ts` holds the handle (`db` and `withTx`, READ COMMITTED, retried up to 3 times on serialization or deadlock errors: DB-05). `lib/server/db/mappers.ts` turns rows into `lib/types.ts` objects (BE-01). ESLint keeps Prisma and the handle's internals inside `lib/server/db/` and `lib/server/repositories/`.
- **Public pages are cached:** every public catalogue read (home, item, shop and category pages, makers, sitemap) comes from one `"use cache"` snapshot tagged `catalogue` (`lib/server/catalogue.ts`). Every action that changes an item, a shop, a review, a question, a moderation decision or an anonymised author calls `refreshEverything()` (`lib/server/actions/refresh.ts`), which expires the tag, so the next visit reads fresh rows. Signed-in, seller and admin pages always read the database directly. Because item, shop and category pages are prerendered, `npm run build` needs a reachable, migrated and seeded database (CI starts one).
- **Errors people see:** the services check every rule first, so the database only refuses a write when two requests race. A unique clash (a second open application, a web address just taken, a repeated vote or report) becomes a `ConflictError` with a plain message (`lib/server/db/pg-errors.ts`); any other database error is logged and shown as the generic message with a reference. Raw PostgreSQL text never reaches a page.
- **Seed loader:** `lib/server/db/load-seed.ts` loads the categories and the demo data into every table in one transaction. With `{ replace: true }` it empties the tables first, so running it again never duplicates rows; it refuses to replace data in production.
- **Done so far:** B03a (people: users, applications, addresses, notifications, audit log, rate events) B03b (catalogue: shops, products; content: reviews, questions, answers, reports, helpful votes) and B03c (commerce: orders, seller orders, items, payouts, custom requests). B04a switched the app to PostgreSQL and removed the dev JSON store; its last version is kept in git as the tag `pre-b04a-dev-store`. B04b adds full-text search and keyset pagination.
- **Paid out once (BR-11):** `setPayoutOnSellerOrders` links only orders with no payout yet. If two payout runs race, the second gets a `ConflictError` and rolls back, so no order is ever paid twice. A repository test runs two payouts side by side to prove it.

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

Go to `/signin`. A **Demo accounts** panel signs you in with one click; it is not rendered in production and the server refuses demo sign-in there.

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
| `/signin`, `/register`                                                                                                                                                                                                                        | Everyone  | Sign-in forms (preview) and the demo accounts panel.                                                                                                                                                       |
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

- **Server checks:** every protected layout, page and action checks the session and role on the server (SEC-A1). Hidden buttons are never the check. `proxy.ts` is only a fast first redirect for visitors with no session.
- **Ownership:** sellers' shops are always loaded by owner, never from IDs in the form (SEC-A2). Other people's orders, items and shops return 404 (SEC-A5).
- **Input:** all input is validated with zod (SEC-A3). User text is rendered as plain text (SEC-A4). Questions, answers, reviews and replies can't contain emails, phone numbers or links (RULE-Q4).
- **Rate limits:** posting actions are rate-limited per user (SEC-A6; limits in `lib/config.ts`).
- **Admin actions:** every admin action needs a confirmation, a reason where the rules require one, and writes an append-only audit row in the same transaction (SEC-A9).
- **Server-only code:** server modules start with `import "server-only"` (SEC-A7). The demo session is disabled in production, and tests prove it (SEC-A8).
- **Buyer details:** sellers see a buyer's name, address and phone only for their own orders, and only until 30 days after delivery (SEC-A10).
- **Response headers:** Content-Security-Policy, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy are set in `next.config.ts`.
  - The CSP allows `'unsafe-inline'` scripts because nonces are incompatible with Partial Prerendering.
  - Images are limited to the Unsplash CDN, and photo links are validated to that host.
- **Errors:** unexpected errors are logged on the server and shown to people as a generic message with a reference ID (CS-14, OPS-02).

**Also included:**

- **Helpful votes:** reviews and questions can be voted helpful, and are sorted most helpful first (FR-19).
- **Payouts:** the weekly payout job (BR-11) is a button on `/admin/payouts` until a background worker exists.
- **Account deletion:** deleting an account anonymises it and keeps order records (FR-17).

**Not production-ready yet:** the demo sign-in makes the features testable, nothing more. Real accounts (Better Auth), PayHere payments and file uploads are still required before launch.

## Tests

`npm test` runs every test against PostgreSQL. Docker must be running: a Vitest global setup (`test/global-setup.ts`) starts one throwaway PostgreSQL with Testcontainers and applies the real migrations, each test file gets its own copy of that database, and the demo data is loaded again before every test (`test/db.ts`). Without Docker the run stops with a clear message instead of skipping database tests.

- **Unit tests:** every business rule, named with its ID (for example `RULE-R1 blocks a review without a delivered order`).
- **Permission tests:** every server action is called as a guest, plus wrong-role and other-owner cases.
- **Production guards:** the demo session is refused in production.
- **Repositories (`test/repositories/`):** each repository against PostgreSQL, plus what only the database enforces: DB-05 retries, DB-07 constraints, DB-09 and DB-10 rights, one payout per order, and a seed loader that can run twice.
- **Caching:** actions that change public data expire the catalogue cache, and failed ones don't (B04a).
- **Transactions:** a failed step writes nothing (DB-04), a status that changed first gives a clear conflict (DB-06), and the shared read handle refuses writes (BE-03).
- **Environment:** `lib/env.ts` refuses demo login in production (AU-09) and names bad keys without echoing values.
- **Logging (OPS-01 to OPS-03):** redaction of secrets and personal data, request-ID rules, the proxy's header and redirects, and the `runAction` and `withRoute` references.
- **Header components:** the header's sign-in states and menus.
- **Full journey:** apply → approve → set up → post → approve item → buy → deliver → review → ask → answer → report → hide.

## Design: Lacquer & Loom

Colours come from Laksha lacquerware and structure from Dumbara weaving.

- **Tokens:** defined in `app/globals.css`. Components use tokens only.
- **Type:** Young Serif and Hanken Grotesk, with Noto Sans Sinhala for Sinhala words.
- **Craft labels:** traditional crafts sit under an arch and carry the lacquer band.
- **Motion:** one orchestrated load moment (the home hero); everything else responds to the person. `prefers-reduced-motion` turns it all off.

## Images

Product and maker photos are free Unsplash images loaded through their CDN (`lib/image-loader.ts`). Shop names, people and stories are illustrative.
