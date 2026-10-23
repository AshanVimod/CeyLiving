# Deploying the CeyLiving demo on Vercel

The public demo runs from the `Feature-02` branch with `DEMO_MODE=true`, so people can try the site and send feedback.
The main build-plan work continues on `Feature-01`. `Feature-02` is never merged back into `Feature-01`; to update the
demo, merge `Feature-01` **into** `Feature-02` (section 4).

## 1. What demo mode does

Everything below only happens when `DEMO_MODE=true`. Without it the app behaves exactly as on `Feature-01`: a
production build serves the seed read-only and nobody can sign in (SEC-A8).

| Area      | In demo mode                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data      | Kept in server memory, starting from the seed. Goes back to the seed on every cold start and every 6 hours (`DEMO_RESET_HOURS` in `lib/config.ts`). Nothing is written to disk. |
| Sign-in   | The "Demo accounts" panel on `/signin` lets testers pick the customer, applicant, seller, suspended seller, admin or muted customer. No passwords.                  |
| Checkout  | Unchanged: the form is checked in the browser and shows a demo message. No order is charged and PayHere is never contacted.                                       |
| Banner    | Every page shows "Demo version — data resets regularly, no real payments. Don't enter real personal details." with a "Give feedback" button linking to `FEEDBACK_URL`. |
| Search    | `robots.txt` disallows everything, pages carry `noindex, nofollow`, and every response sends `X-Robots-Tag: noindex, nofollow`.                                 |

`ENABLE_DEMO_LOGIN` is a different switch: it is a developer's local shortcut, and the app still refuses to start with
`ENABLE_DEMO_LOGIN=true` in production (AU-09). Don't set it on Vercel; `DEMO_MODE` is the only flag the demo needs.

### Known limits

- **Each server copy has its own data.** Vercel can run more than one copy of the app at once, and each keeps its own
  memory. A tester may occasionally see a change disappear when their request reaches another copy, or after a cold
  start. The banner tells them data resets.
- **Some pages are built ahead of time.** Catalogue pages are prerendered from the seed during the build, so a product a
  tester adds or edits as the seller may not show on every public page straight away.
- **Memory.** Data only grows until the next reset. That's fine for a small group of testers.

## 2. Before the first deploy

1. Make the feedback form (for example a Google Form). Copy its share link: it must start with `https://`.
2. Check the branch builds the way Vercel will build it (Git Bash, in the `ceyliving` folder):

   ```bash
   git switch Feature-02
   ```

   ```bash
   NODE_ENV=production DEMO_MODE=true npm run build
   ```

## 3. Connect the repository to Vercel (Hobby plan)

1. Sign in at <https://vercel.com> with your GitHub account (the free **Hobby** plan is enough).
2. **Add New… → Project**, then **Import** the `AshanVimod/CeyLiving` repository. If it isn't listed, choose **Adjust
   GitHub App Permissions** and give Vercel access to it.
3. On the import screen:
   - **Framework Preset:** Next.js (detected automatically).
   - **Root Directory:** leave as `./` (the repository root holds `package.json`).
   - **Build and Output Settings:** leave the defaults (`npm run build`, `npm install`).
   - **Environment Variables:** add these two (they apply to Production by default):

     | Name           | Value                                    |
     | -------------- | ---------------------------------------- |
     | `DEMO_MODE`    | `true`                                   |
     | `FEEDBACK_URL` | your form link, e.g. `https://forms.gle/…` |

     Don't add `NODE_ENV` (Vercel sets it) or `ENABLE_DEMO_LOGIN`. No secrets are needed.

4. Click **Deploy**. This first deploy builds the repository's default branch (`main`), which doesn't have demo mode.
   That's expected; the next steps switch production to `Feature-02`.

### Make `Feature-02` the production branch

1. Open the project → **Settings → Environments → Production**. Under **Branch Tracking**, set the branch to
   `Feature-02` and save. (On older dashboards this is **Settings → Git → Production Branch**.)
2. Go to **Deployments**, open the menu (**⋯**) on the latest `Feature-02` deployment and choose **Promote to
   Production**. If there's no `Feature-02` deployment yet, choose **Create Deployment**, enter the branch
   `Feature-02` and deploy.
3. Open the production URL (`https://<project>.vercel.app`) and check:
   - the yellow demo banner is at the top, and **Give feedback** opens your form;
   - `/robots.txt` shows `Disallow: /`;
   - `/signin` shows the **Demo accounts** panel, and the admin account opens `/admin`.

### Stop building the other branches (recommended)

Vercel also builds a preview for every push to `Feature-01` and `main`. Those previews don't have `DEMO_MODE`, so they
only allow browsing. To skip them and save build minutes: **Settings → Git → Ignored Build Step**, choose **Custom**
and enter:

```bash
[ "$VERCEL_GIT_COMMIT_REF" != "Feature-02" ]
```

(The command exiting with 0 tells Vercel to skip the build, so every branch except `Feature-02` is skipped.)

### Changing a variable later

Change it under **Settings → Environment Variables**, then redeploy (**Deployments → ⋯ → Redeploy**). Variables are
read at build time too, so a redeploy is needed for the banner and noindex settings to change.

## 4. Refreshing the demo from `Feature-01`

Do this whenever you want testers to see the latest work. Always merge `Feature-01` into `Feature-02`, never the other
way round.

1. Start clean, with everything on `Feature-01` committed and pushed:

   ```bash
   git status
   ```

2. Switch to the demo branch and update both branches from GitHub:

   ```bash
   git switch Feature-02
   ```

   ```bash
   git pull
   ```

   ```bash
   git fetch origin
   ```

3. Merge:

   ```bash
   git merge origin/Feature-01
   ```

4. If there are no conflicts, go to step 6.

5. **If Git reports conflicts**, list the files:

   ```bash
   git status
   ```

   Open each file marked "both modified". Git shows both versions between `<<<<<<<`, `=======` and `>>>>>>>`. Keep the
   new `Feature-01` code **and** the demo pieces, then delete the markers. The files most likely to conflict, and the
   demo part to keep in each:

   | File                                         | Keep                                                                       |
   | -------------------------------------------- | -------------------------------------------------------------------------- |
   | `lib/env.ts`, `.env.example`                 | the `DEMO_MODE` and `FEEDBACK_URL` entries next to the new keys            |
   | `lib/server/runtime.ts`                      | `isDemoMode` and `demoSignInAllowed`                                       |
   | `lib/server/store/dev-store.ts`              | `demoState` and the in-memory branch in `readStore` / `transaction`        |
   | `lib/session.ts`, `lib/server/actions/session.ts` | the `demoSignInAllowed()` checks                                      |
   | `app/signin/page.tsx`, `components/account/demo-accounts-panel.tsx` | the `publicDemo` text                               |
   | `app/layout.tsx`, `next.config.ts`           | `<DemoBanner />`, the demo `robots` metadata and the `X-Robots-Tag` header |

   If you're unsure, stop the merge and ask for help; nothing has changed yet:

   ```bash
   git merge --abort
   ```

   When every conflict is fixed, mark the files as resolved and finish the merge:

   ```bash
   git add -A
   ```

   ```bash
   git commit --no-edit
   ```

6. Check the merged code and the demo build:

   ```bash
   npm run check
   ```

   ```bash
   NODE_ENV=production DEMO_MODE=true npm run build
   ```

7. Push. Vercel deploys `Feature-02` to production automatically:

   ```bash
   git push
   ```

### Checklist for each refresh

`Feature-01` keeps gaining backend features, so before pushing a refresh check the new work against the demo:

- **Anything that contacts a real person or service stays off when `DEMO_MODE=true`**: email, SMS, PayHere payments,
  payouts, webhooks. Add a `DEMO_MODE` check next to the new code and an env rule if it needs secrets.
- **Storage.** Demo mode relies on the JSON dev store. When `Feature-01` moves to a real database (the DB- tasks in
  `docs/backend-plan.docx`), demo mode needs a new design, for example a separate free database that a job resets to
  the seed. Do that as its own task.
- **Sign-in.** When Better Auth replaces the demo cookie, keep a way for testers to use the demo accounts.
- Walk through the main flows on the production URL: browse, search, product page, cart, checkout preview, wishlist,
  and sign in as the customer, seller and admin.
