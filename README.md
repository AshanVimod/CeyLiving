# CeyLiving

A marketplace connecting Sri Lankan artisans and entrepreneurs with customers.

Marketplace for independent Sri Lankan makers: the public storefront (build spec T08) plus accounts, seller shops, items, orders, verified reviews, questions and admin moderation (feature spec `CeyLiving_Feature_Spec.docx`, tasks C01–C13). Data lives in a development store until the NestJS API and database arrive.

## Run it

Needs Node 22 (`.nvmrc`; `engines` in `package.json`).

```bash
npm install
npm run setup
npm run dev
```

Open http://localhost:3000. On first run the dev store seeds `.data/dev-store.json` (git-ignored) from `lib/data/`. Delete that file to start again from the seed.

| Command | What it does |
| --- | --- |
| `npm run setup` | Checks the Node version and copies `.env.example` to `.env.local` if it doesn't exist. Later backend tasks add Docker services, migrations and the seed. |
| `npm run dev` | Starts Next.js in development. |
| `npm run check` | Format check + lint + typecheck + tests. Run it before every commit; CI runs the same command. |
| `npm run format` | Formats every file with Prettier (`.prettierrc.json`, 120 columns). |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | The parts of `check` on their own. |
| `npm run build` / `npm start` | Production build and start. |

A pre-commit hook (Husky + lint-staged) runs Prettier and `eslint --fix` on staged files. `.editorconfig` and `.gitattributes` keep indentation and LF line endings the same on every OS.

## Environment variables

`lib/env.ts` checks every variable with zod when the server starts (`instrumentation.ts`). A missing or malformed value stops the app with a message naming the key (never the value). `.env.example` lists every key; put real values in `.env.local` (git-ignored). Empty values count as not set.

| Variable | Values | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | Set by Next.js and Vitest. Don't set it in `.env` files. |
| `ENABLE_DEMO_LOGIN` | `true` / `false` (default `false`) | Demo sign-in, development only (AU-09). The app refuses to start with `true` in production. For now it is only validated; the demo panel still follows `NODE_ENV` until Better Auth (B05). |
| `CEYLIVING_STORE_PATH` | file path | Dev store file. Default `.data/dev-store.json`; tests use a temp file. |

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: `npm ci` → `npm run check` → `npm run build` → `npm audit` → Gitleaks secret scan. Actions are pinned by commit SHA.

**npm audit:** `npm audit --omit=dev --audit-level=high` blocks CI, so production dependencies must stay clean. The full audit runs too but only reports. It currently shows 5 high findings in dev-only dependencies (`braces` → `micromatch` → `fast-glob` → `eslint-config-next`). They are accepted for now because they run only in ESLint on developer machines and CI, never in the app, and the only offered fix is downgrading `eslint-config-next` to 14, which breaks linting for Next.js 16. Revisit when `eslint-config-next` ships a fixed version.

## Demo accounts (development only)

Go to `/signin`. A **Demo accounts** panel signs you in with one click; it is not rendered in production and the server refuses demo sign-in there.

| Account | What to try |
| --- | --- |
| Customer (Anushka) | Orders: one delivered and ready to review, one on its way ("I received this"), one new. Ask questions, report content, save addresses. |
| Applicant (Tharindu) | Application pending: see its status on `/account`. |
| Seller (Ruwan, Ambalangoda Mask House) | `/seller`: accept and dispatch the new order, answer the open question, reply to reviews, add items (publish straight away). |
| Seller, suspended (Chaminda, Pol Katu Lanka) | Shop hidden everywhere; dashboard explains why. |
| Admin (Dilani) | `/admin`: approve the application, suspend shops, review items, moderate posts, mute users, read the audit log. |
| Muted customer (Nuwan) | Can browse and buy, can't post for 7 days. |

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/`, `/shop`, `/c/[slug]`, `/search`, `/p/[slug]`, `/makers`, `/shop/[slug]`, `/heritage`, `/custom`, `/about`, `/sell`, `/help` | Everyone | Storefront. Only ACTIVE items of ACTIVE shops are shown (RULE-P4, RULE-S4). Item pages carry Q&A, reviews and report buttons. |
| `/cart`, `/checkout`, `/account/wishlist` | Everyone | Cart and wishlist kept in the browser; summaries come from `/api/catalogue` so hidden items drop out. |
| `/signin`, `/register` | Everyone | Sign-in forms (preview) and the demo accounts panel. |
| `/account`, `/account/orders`, `/account/orders/[orderNumber]`, `/account/addresses`, `/account/questions`, `/account/requests`, `/account/notifications` | Signed in | Profile with role cards and privacy (FR-1, FR-17), orders and reviews (FR-6, FR-3a), addresses (FR-12), my questions, custom requests (FR-14), notifications (FR-11). |
| `/account/export` | Signed in | Download my data as JSON (FR-17). Only the requester’s own data, never cached. |
| `/sell/apply`, `/sell/apply/submitted` | Customers | Apply to sell (FR-2a). |
| `/seller`, `/seller/shop`, `/seller/products`, `/seller/products/new`, `/seller/products/[id]/edit`, `/seller/orders`, `/seller/orders/[id]`, `/seller/questions`, `/seller/reviews`, `/seller/requests`, `/seller/payouts` | Sellers | Set-up checklist, shop profile and payout details, items, orders (BR-07), questions, review replies, custom requests, payout statements (FR-2b, FR-2c, FR-7, FR-13, FR-14, FR-18). |
| `/admin`, `/admin/applications`, `/admin/applications/[id]`, `/admin/sellers`, `/admin/sellers/[shopId]`, `/admin/products`, `/admin/moderation`, `/admin/reports`, `/admin/users`, `/admin/users/[id]`, `/admin/payouts`, `/admin/audit-log` | Admins | Dashboard, applications, shops, item review, moderation, reports, users and role changes, payouts, audit log (FR-4, FR-5, FR-8 to FR-10, FR-13, FR-15, FR-16). |

## How the code is organised

Requests follow the feature spec (section 7.2): **form → server action → service → repository → store**.

- `lib/server/actions/*` — thin server actions: who is asking (`requireActor`) → validate with zod (`lib/validation/*`) → call a service → revalidate → return `{ ok, message, fieldErrors }`.
- `lib/server/services/*` — every business rule (RULE-A, S, P, R, Q, M, N), status-flow tables and audit rows. Pure functions of an actor and input, so they are unit-tested directly.
- `lib/server/repositories/*` — the only code that reads the store.
- `lib/server/store/dev-store.ts` — one JSON file, atomic writes (temp file + rename), serialised in-process, all-or-nothing transactions. In production it serves the seed read-only and refuses every write.
- `lib/server/permissions.ts` / `auth.ts` — `requireUser`, `requireRole`, `assertShopOwner`, `canPost`.

**Replacing the dev store:** when the NestJS API / Prisma database exists, rewrite `lib/server/repositories/*` and `transaction()` against it, and replace `getSession()` and the sign-in page with Better Auth (T04). Services, actions and pages stay as they are.

## Security

- **Server checks:** every protected layout, page and action checks the session and role on the server (SEC-A1). Hidden buttons are never the check. `proxy.ts` is only a fast first redirect for visitors with no session.
- **Ownership:** sellers' shops are always loaded by owner, never from IDs in the form (SEC-A2). Other people's orders, items and shops return 404 (SEC-A5).
- **Input:** all input is validated with zod (SEC-A3). User text is rendered as plain text (SEC-A4). Questions, answers, reviews and replies can't contain emails, phone numbers or links (RULE-Q4).
- **Rate limits:** posting actions are rate-limited per user (SEC-A6; limits in `lib/config.ts`).
- **Admin actions:** every admin action needs a confirmation, a reason where the rules require one, and writes an append-only audit row in the same transaction (SEC-A9).
- **Server-only code:** server modules start with `import "server-only"` (SEC-A7). The demo session and dev store are disabled in production, and tests prove it (SEC-A8).
- **Buyer details:** sellers see a buyer's name, address and phone only for their own orders, and only until 30 days after delivery (SEC-A10).
- **Response headers:** Content-Security-Policy, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy are set in `next.config.ts`.
  - The CSP allows `'unsafe-inline'` scripts because nonces are incompatible with Partial Prerendering.
  - Images are limited to the Unsplash CDN, and photo links are validated to that host.
- **Errors:** unexpected errors are logged on the server and shown to people as a generic message (CS-14).

**Also included:**
- **Helpful votes:** reviews and questions can be voted helpful, and are sorted most helpful first (FR-19).
- **Payouts:** the weekly payout job (BR-11) is a button on `/admin/payouts` until a background worker exists.
- **Account deletion:** deleting an account anonymises it and keeps order records (FR-17).

**Not production-ready yet:** the demo sign-in and JSON store make the features testable, nothing more. Real accounts (Better Auth), a real database, PayHere payments and file uploads are still required before launch.

## Tests

`npm test` runs 141 tests:

- **Unit tests:** every business rule, named with its ID (for example `RULE-R1 blocks a review without a delivered order`).
- **Permission tests:** every server action is called as a guest, plus wrong-role and other-owner cases.
- **Production guards:** the demo session and dev store are refused in production.
- **Environment:** `lib/env.ts` refuses demo login in production (AU-09) and names bad keys without echoing values.
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
