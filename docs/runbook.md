# CeyLiving runbook

How CeyLiving runs in staging and production, and what to do when something has to change or goes wrong. Backend plan section 17 (B14). Keep this file current: every change to the deploy, the backups or the secrets updates it in the same commit.

**Recovery targets (17.4):** lose at most 15 minutes of data (RPO), be back online within 4 hours (RTO).

## Contents

1. [How it runs](#1-how-it-runs)
2. [Setting up the server](#2-setting-up-the-server)
3. [Deploy workflow](#3-deploy-workflow)
4. [Deploy](#4-deploy)
5. [Rollback](#5-rollback)
6. [Migrations and rollback](#6-migrations-and-rollback)
7. [Backups](#7-backups)
8. [Restore](#8-restore)
9. [Restore drill](#9-restore-drill)
10. [Rotating a secret](#10-rotating-a-secret)
11. [Breach response](#11-breach-response)
12. [Scaling](#12-scaling)
13. [Running it on your computer](#13-running-it-on-your-computer)

## 1. How it runs

One VPS (4 GB, 2 vCPU, Singapore, Ubuntu 24.04) runs Docker. Staging and production are two Docker Compose projects on it (`ceyliving-staging`, `ceyliving-production`), each in its own folder under `/opt/ceyliving/`, with its own database (Neon), buckets (R2), settings and Cloudflare tunnel. Staging sits behind Cloudflare Access.

| Service       | What it does                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `migrate`     | One-off: `prisma migrate deploy` and `jobs:migrate`, as the schema owner `ceyliving_migrator` (DB-10). Runs first.   |
| `web`         | The Next.js app (`node server.js`, standalone output). One process (section 12). Health check: `/api/ready`.         |
| `worker`      | Background jobs (pg-boss), as `ceyliving_app`.                                                                       |
| `cloudflared` | The tunnel: the only way in. **No service publishes a port**, so the server needs no inbound port except SSH.       |
| `backup`      | Nightly encrypted dump (section 7). Profile `ops`: never started by `docker compose up`.                            |

All of them come from one image per environment, `ghcr.io/<owner>/ceyliving:<commit>-<environment>` (the backup has its own, `ceyliving-backup:<commit>`). Why one per environment: `SITE_URL`, `PAYHERE_MODE`, `R2_ACCOUNT_ID` and `NEXT_PUBLIC_IMAGE_BASE_URL` are fixed into the image when it is built (security headers, allowed origins, image addresses), so staging's image can't serve production. Both are built from the same commit.

**Hardening.** Every container runs as a non-root user with all Linux capabilities dropped and `no-new-privileges`. Worker, migrate, backup and tunnel have a read-only file system (`/tmp` in memory). The web app can write only to Next's page cache (`.next/server/app`, `.next/cache`); the rest of the image belongs to root. Each service gets only its own settings file, so the worker never holds the bank-details key and the web app never holds the migrator's password.

**No data in the image, and none served from it.** `next build` prerenders pages from a database, and after every start (a deploy, a crash, a reboot) Next serves each page it prerendered at build time **once more** before rendering it fresh, even when that page has expired. So images are built from a migrated but **empty** database: no item, shop or demo data is ever in an image (the item and shop routes are built with a placeholder slug that matches nothing). As soon as the web app listens, it expires the whole catalogue on itself and requests the sitemap and every list page once (`instrumentation.ts`, `expireBuildCatalogue`), so those one-time build copies (empty lists) go to that request, not to a visitor, a second or two after start. If the expiry fails for a minute, the process exits and Docker restarts it (`catalogue.start_refresh_failed` in the log). Item and shop pages are rendered from the live database on their first visit; the deploy warm-up (section 4) does that for every address in the sitemap.

## 2. Setting up the server

Once per server; most of it once per environment.

1. **Server.** Ubuntu 24.04, SSH keys only (`PasswordAuthentication no`), `unattended-upgrades`, `fail2ban`, firewall allowing only SSH from your IP (`ufw default deny incoming; ufw allow from <your IP> to any port 22; ufw enable`). Install Docker Engine and the Compose plugin from Docker's apt repository.
2. **Deploy user.** `adduser --disabled-password deploy`, `usermod -aG docker deploy`. Membership of `docker` is equal to root on this machine; that is why its keys are locked to one command (step 7).
3. **Folders.** As root:
   ```bash
   install -d -o root -g root /opt/ceyliving/bin
   install -m 755 infra/deploy/deploy.sh infra/vps/run-backup.sh /opt/ceyliving/bin/
   install -d -o deploy -g deploy -m 750 /opt/ceyliving/staging /opt/ceyliving/production
   ```
   In each environment folder, as `deploy`: `docker-compose.yml` (from the commit you deploy), `deploy.conf` with `CEYLIVING_REGISTRY=ghcr.io/<owner>` (lowercase), and `env/` with the files from `infra/env/*.example` filled in, renamed to `*.env`, `chmod 600`. Add `COMPOSE_PROJECT_NAME=ceyliving-staging` (or `-production`) to a `.env` file there, so the backup objects are named after the environment.
4. **Registry access.** As `deploy`: `docker login ghcr.io -u <github user>` with a fine-grained token that can only read packages.
5. **Database (Neon, Singapore).** PostgreSQL **17** (the backup image's tools are 17). Roles: `ceyliving_migrator` owns the database; `ceyliving_app` is created with a strong password before the first deploy (`CREATE ROLE ceyliving_app LOGIN PASSWORD '…'`); the first migration grants it its rights. Use the pooled address for `DATABASE_URL`, the direct one for `DATABASE_MIGRATION_URL` and `DATABASE_BACKUP_URL`. Production: a paid plan with point-in-time recovery of at least 7 days.
6. **Tunnels.** Cloudflare Zero Trust > Networks > Tunnels. Two kinds:
   - **Site tunnel, one per environment** (runs as the `cloudflared` service in compose): public hostname `yourdomain` (or `staging.yourdomain`) to `http://web:3000`. Its token goes in `env/tunnel.env`.
   - **SSH tunnel, one for the server** (runs on the host: `cloudflared service install <token>`): public hostnames `ssh-staging.yourdomain` and `ssh-production.yourdomain`, both to `ssh://localhost:22`.

   In Access, protect all of staging and both SSH hostnames. Create a **service token** for GitHub and allow it in those policies (plus your own email for staging).
7. **Deploy keys.** On your computer, `ssh-keygen -t ed25519 -f deploy-staging -C deploy-staging` (and `deploy-production`). In `/home/deploy/.ssh/authorized_keys`, one line each:
   ```
   command="/opt/ceyliving/bin/deploy.sh staging",restrict ssh-ed25519 AAAA… deploy-staging
   command="/opt/ceyliving/bin/deploy.sh production",restrict ssh-ed25519 AAAA… deploy-production
   ```
   The key then can only run the deploy script for its environment, with no shell, forwarding or terminal. The private keys go into GitHub (section 3) and nowhere else.
8. **Backups.** Section 7.
9. **Monitoring.** UptimeRobot (or Better Stack) on `https://yourdomain/api/ready` and `https://yourdomain/api/health/worker`, alerts to your phone. The app's own alerts (OPS-06) email the admins.

## 3. Deploy workflow

`.github/workflows/deploy.yml` runs after CI passes on `main`: staging first (build, deploy, smoke test), then production after your approval.

In GitHub, Settings > Environments, create `staging` and `production`. For `production`, add yourself as **required reviewer** and allow only the `main` branch. Each environment gets:

| Kind     | Name                                                                                  | Value                                                                       |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Variable | `SITE_URL`, `PAYHERE_MODE`, `R2_ACCOUNT_ID`, `NEXT_PUBLIC_IMAGE_BASE_URL`              | The environment's own (same as in its `env/common.env`)                     |
| Variable | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`                                                   | `ssh-<environment>.yourdomain`, `deploy`                                    |
| Secret   | `DEPLOY_SSH_KEY`                                                                       | The private deploy key of that environment                                  |
| Secret   | `DEPLOY_KNOWN_HOSTS`                                                                   | `ssh-<environment>.yourdomain ssh-ed25519 AAAA…` (`ssh-keyscan` on the VPS) |
| Secret   | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`                                       | The Access service token                                                    |

No server secret (database, PayHere, keys) is ever in GitHub: the image is built with placeholders and a throwaway database, and the real settings live only in the server's `env/` files.

## 4. Deploy

Normally: merge to `main`; CI runs; Deploy runs. Approve the production job when staging's smoke test has passed (Actions > the run > Review deployments).

What `deploy.sh` does, in order:

1. Checks the tag (`<40-hex commit>-<environment>`, matching the key's environment), takes the environment's lock.
2. Pulls the app and backup images.
3. Checks that the server's `docker-compose.yml` is identical to the one inside the image. If not, it stops with `compose_file_differs`: copy the file from that commit to the server, then run the deploy again.
4. **Runs `migrate` with the new image.** If it fails, it stops: nothing has been switched and the old version keeps serving.
5. Starts web, worker and tunnel on the new image and waits until web is healthy (`/api/ready`, up to 3 minutes). If it isn't, it starts the previous image again and reports `not_ready`.
6. Records the new tag (`.deploy/current.env`, the old one in `previous.env`).
7. Warms the cache: requests every address in `/sitemap.xml` from inside the web container, two at a time (about 3–4 minutes at 1,000 items; failures are reported, not fatal).

Expect 10–20 seconds of errors (Cloudflare 502) while the web container is replaced: one web process (section 12). Deploy when traffic is low.

**By hand on the server** (as `deploy`): `/opt/ceyliving/bin/deploy.sh production deploy <commit>-production`, or `… status`. **Redeploy a commit** without merging: Actions > Deploy > Run workflow, choose the environment; an image already built for that commit and environment is reused.

## 5. Rollback

Redeploy the previous image; the database stays as it is (section 6).

- **From GitHub:** Actions > Deploy > Run workflow > environment, action `rollback`.
- **On the server:** `/opt/ceyliving/bin/deploy.sh production rollback`.

It switches to the tag in `.deploy/previous.env`, without migrating, and waits for `/api/ready`. To go further back, deploy that commit's tag explicitly (section 4); its image is reused.

If the whole site must go down: in Cloudflare, point the hostname at a maintenance page (a Worker or a Page Rule), or `docker compose stop cloudflared`.

## 6. Migrations and rollback

The deploy runs migrations **before** the new version starts, and a failed start or a rollback runs the **previous** version on the **migrated** database. So every migration must leave the database usable by the version before it (DB-11, expand → migrate → contract):

- **Expand** (any release): add a table, a nullable column or one with a default, an index (`CONCURRENTLY` on big tables), a constraint old rows and the old code already satisfy.
- **Contract** (a later release, once no running version uses the old thing): drop or rename a column or table, `SET NOT NULL`, change a type. Write `-- DB-11 contract: <why nothing uses it any more>` at the top of the migration. A test (`infra/deploy/migrations-rollback.test.ts`) fails on any drop, rename, type change or `SET NOT NULL` without that line.
- After a contract migration, roll back only to a version released after the expand step, never further.
- A migration that went wrong is fixed by a new migration, never by editing or deleting an applied one.

## 7. Backups

Two layers:

1. **Neon point-in-time recovery** (production: at least 7 days). The first choice for any restore: it can return to any second (RPO minutes).
2. **Nightly encrypted dump** to a separate R2 bucket, kept 30 days: for disasters Neon's history doesn't cover (the project deleted, the account lost, a problem noticed after the PITR window).

**What the nightly job does** (`infra/backup/backup.sh`, 01:30 Sri Lankan time): `pg_dump` (custom format, as the schema owner, so the job queue is included) streamed straight into `age` (encrypted to a public key) while a copy is read back with `pg_restore --list` to prove the dump is complete; the encrypted file and its SHA-256 are uploaded to `<bucket>/<project>/YYYY/MM/DD/<time>.dump.age`, and the stored size is checked. The unencrypted dump never touches a disk, and **the server has no way to decrypt a backup**. Then `run-backup.sh` records `backup ok` or `backup failed` as an Operations checkpoint (OPS-07): `/admin` shows the last backup, and OPS-06 alerts every admin when a backup fails or none has succeeded for 26 hours.

**What a backup does not contain:** `FIELD_ENCRYPTION_KEY` (bank account numbers stay encrypted in it) and any other secret, and the uploaded photos (they are in R2; turn on object versioning on the uploads bucket for accidental deletes).

**Set-up, once per environment:**

1. **Key pair.** On your computer: `age-keygen -o ceyliving-backup-<environment>.key`. It prints the public key (`age1…`): put it in `env/backup.env` as `BACKUP_AGE_RECIPIENT`. Store the key file in the password manager (and an offline copy), then delete it from the computer. **Without it, no backup can be restored.**
2. **Bucket.** R2 > Create bucket `ceyliving-backups` (one for all environments is fine; objects are under the project name), location Asia-Pacific. Settings > Object lifecycle rules: delete objects 30 days after upload. Two API tokens limited to this bucket: one Object Read & Write (for the server, `env/backup.env`), one Object Read only (for restore drills, kept in the password manager).
3. **Timer.** As root:
   ```bash
   cp infra/vps/ceyliving-backup@.service infra/vps/ceyliving-backup@.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now ceyliving-backup@production.timer ceyliving-backup@staging.timer
   systemctl start ceyliving-backup@production.service   # a first backup now
   journalctl -u ceyliving-backup@production.service     # the JSON lines: backup.done, key, bytes, sha256
   ```
   `systemctl list-timers` shows the next run.

## 8. Restore

Decide first: **who decides** is the owner (you). Write down the time of the problem, as exactly as possible.

**A. Point in time (preferred, data damaged or deleted in the last 7 days).** Neon console > the project > Branches > Create branch from a point in time just before the problem. Check the branch (connect with `psql` and look at the damaged rows). Then either:

- **Copy back the damaged rows** from the branch into production (small, careful damage: one shop, some orders), or
- **Switch to the branch:** put its connection strings in the environment's `env/common.env`, `env/migrate.env` and `env/backup.env`, then redeploy the current tag (`deploy.sh production deploy <current tag>`). Data written after the chosen time is lost: note what (orders, payments) and reconcile them from PayHere and email.

**B. From a nightly dump (PITR can't help).**

1. Create an empty database (a new Neon project or branch) with the two roles, as in section 2 step 5.
2. On your computer, with the read-only bucket token and the private key, download and decrypt the chosen dump (the restore drill's steps, or by hand: `rclone copyto r2:ceyliving-backups/<key> backup.age`, check it against `<key>.sha256`, `age --decrypt -i <key file> -o backup.dump backup.age`).
3. `pg_restore --no-owner --role=ceyliving_migrator --dbname=<direct URL as ceyliving_migrator> backup.dump`, then run the migrate step once (`docker compose run --rm migrate`): it re-applies the grants of section 2 and any newer migrations.
4. Point the environment at the new database (as in A) and redeploy.
5. Delete the decrypted `backup.dump` and the key file from your computer.

Afterwards: smoke test, check `/admin` (Operations card), tell sellers if orders were lost, and record what happened in section 9's log.

## 9. Restore drill

Monthly, and after any change to the backup set-up: prove that a backup restores. `infra/backup/restore-drill.sh` runs on your computer (Docker needed). It starts a throwaway PostgreSQL 17 container, downloads the backup, checks its SHA-256, decrypts it, restores it and counts rows; then it removes everything. It never connects to a live database.

```bash
npm run docker:build:backup                 # or use the server's image: --image ghcr.io/<owner>/ceyliving-backup:<commit>
infra/backup/restore-drill.sh --env-file drill.env --identity ceyliving-backup-production.key
```

`drill.env` holds the **read-only** bucket token: `BACKUP_BUCKET`, `BACKUP_ENVIRONMENT=ceyliving-production` and the `RCLONE_CONFIG_R2_*` lines of section 7. The report is one line, `drill.done`, with the object, its size, the restore time, the newest migration and row counts. Compare the newest migration with production's (`deploy.sh production status` gives the commit), check the counts are plausible, and add a row below. Then delete the key file and `drill.env`.

### Restore drill log

| Date | Where | Backup | Result | Restore time | Notes |
| ---- | ----- | ------ | ------ | ------------ | ----- |
| 2026-11-11 | Local (B14), S3 stand-in (`rclone serve s3`) instead of R2 | `ceyliving-staging/2026/11/11/2026-11-11T030826Z.dump.age`, 223,068 bytes, made by `run-backup.sh staging` through `docker compose` from a copy of the dev database | Passed: SHA-256 ok, decrypted, restored, newest migration `20261110130000_rate_limits_purge_raw_ips` (= the code's), rows: users 24, shops 10, products 34, orders 16, payments 2, audit_log 5, pgboss jobs 354 | 2 s (21 s with set-up) | `backup ok` checkpoint recorded; a wrong database password recorded `backup failed`; a wrong age key stopped the drill at decrypt. **Still to do: the same drill against real R2 on staging (Phase 4).** |

## 10. Rotating a secret

Rotate on a schedule only where noted; always at once after a suspected leak. Generate each new value with `openssl rand -base64 32` unless noted, store it in the password manager, put it in the server's `env/` file, and redeploy the current tag (`deploy.sh <environment> deploy <current tag>`; it restarts web and worker). Never reuse a value across environments or secrets.

| Secret (file)                                                   | Effect of changing it, and steps                                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` (common)                                   | Everyone is signed out; email links in flight stop working. Change, redeploy.                                                                                                      |
| `CACHE_REFRESH_SECRET` (common)                                 | Web and worker read the same file, so they change together. Change, redeploy.                                                                                                      |
| `FIELD_ENCRYPTION_KEY` (web)                                    | README, "Bank details": new key, old one in `FIELD_ENCRYPTION_PREVIOUS_KEYS`, redeploy, `docker compose run --rm --no-deps -w /app/ops --entrypoint node web --conditions=react-server dist/payouts-reencrypt.mjs` (it runs with the web app's settings), check with `--check`, remove the old key, redeploy. Keep the old key offline 30 days: older nightly dumps need it. |
| `IP_HASH_KEY` (web)                                             | Sign-in limits start over; old audit hashes no longer match new ones. Change, redeploy. Only after a leak.                                                                         |
| `DATABASE_URL` password (`ceyliving_app`)                       | Neon: reset the role's password, update `env/common.env`, redeploy.                                                                                                                |
| `DATABASE_MIGRATION_URL` / `DATABASE_BACKUP_URL` (migrator)     | Neon: reset `ceyliving_migrator`'s password, update `env/migrate.env` and `env/backup.env`, run `systemctl start ceyliving-backup@<environment>.service` to check.                  |
| `PAYHERE_MERCHANT_SECRET`, `PAYHERE_APP_SECRET`                 | Regenerate in PayHere, update, redeploy at once (payments are refused with the old one).                                                                                           |
| `TURNSTILE_SECRET_KEY`                                          | Rotate in Cloudflare Turnstile, update, redeploy.                                                                                                                                  |
| `R2_*` (common), backup token (backup)                          | Create a new token in R2, update, redeploy (or run a backup), then delete the old token.                                                                                           |
| `RESEND_API_KEY` (worker)                                       | Create a new key in Resend, update, redeploy, delete the old key.                                                                                                                  |
| `TUNNEL_TOKEN` (tunnel)                                         | Cloudflare > the tunnel > Refresh token, update, `docker compose up -d cloudflared`.                                                                                               |
| Backup age key                                                  | New key pair (section 7), new public key in `env/backup.env`. Keep the old private key until the last backup made with it is 30 days old.                                         |
| Deploy SSH key, Access service token, registry token            | New key or token, replace it in `authorized_keys` / GitHub / `docker login`, remove the old one.                                                                                    |

## 11. Breach response

For a suspected leak of personal data, payment data or secrets, or someone else controlling an account, the server or the code.

**Who decides:** the owner (you) leads and decides on shutting down, notifying and communicating. Write a timeline from the first moment: what was noticed, when, by whom, what was done.

1. **Contain (first hour).**
   - Put the site in maintenance (section 5) if data is still leaking or being changed.
   - Rotate what may be exposed (section 10). Revoke sessions: rotating `BETTER_AUTH_SECRET` signs everyone out.
   - Suspend affected accounts (`/admin/users`), revoke deploy keys and tokens you didn't issue, check `authorized_keys`, `docker ps`, GitHub's audit log and Cloudflare's audit log.
   - Keep evidence: don't delete logs or containers. Copy the relevant logs (`docker compose logs --since 48h > incident-<date>.log`), the audit log rows (`audit_log` by time and request ID) and the Operations card's security events.
2. **Assess (first day).** What data, whose, how many people, since when. Use `docs/data-inventory.md` (B15) for which fields are personal. Encrypted bank numbers are exposed only if `FIELD_ENCRYPTION_KEY` was also exposed; nightly dumps are useless without the age private key.
3. **Notify.** Under Sri Lanka's Personal Data Protection Act (No. 9 of 2022), tell the Data Protection Authority **without undue delay** (plan for 72 hours from becoming aware) when the breach is likely to harm people, and tell the affected people when the risk to them is high: what happened, what data, what they should do (change password, watch for fraud). Tell PayHere at once if payment notifications or the merchant secret are involved. Check the current DPA guidance and your lawyer's advice; record the decision either way.
4. **Recover.** Fix the cause, deploy the fix, restore data if it was changed (section 8), take the site out of maintenance, watch alerts closely for a week.
5. **Review (within 2 weeks).** What happened, why, what changes; update this runbook.

## 12. Scaling

**Now: one web process.** Measured (B13): one process holds 7 requests a second with p95 under 140 ms; at 10 a second item pages reach their limit. Watch the uptime monitor's response times and `docker stats`.

**Before adding a second web process** (sustained load above about 5 requests a second, or before the public launch), the cache needs coordinating first. Each process keeps its `"use cache"` entries and its page cache in memory, and a refresh (`updateTag`, `revalidateTag`) reaches only the process that ran it, so a second process would keep showing old prices, stock and hidden items. Next's page cache checks tags only inside its own process, so a shared `cacheHandlers` handler alone does not fix it. The planned approach (a task of its own): every process listens on a PostgreSQL channel (`LISTEN`); every refresh, from an action or the worker, sends the tags there (`NOTIFY`); each process then calls its own refresh route for those tags. With that in place: set `scale: 2` for web, add a `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` shared by both, and deploy by starting the new version beside the old (no more 10–20 second gap).

**Before that,** vertical first: a bigger VPS (more CPU per process helps every page render).

## 13. Running it on your computer

To check the image and the compose file locally (the dev PostgreSQL from `npm run db:up` must be running):

1. `env/` (git-ignored): an **empty** build database: `docker exec ceyliving-dev-postgres-1 psql -U ceyliving_migrator -d postgres -c "CREATE DATABASE ceyliving_build"`, then `npx prisma migrate deploy` with `DATABASE_MIGRATION_URL` pointing at it (never seed it). Copy `infra/env/build.env.example` to `env/build.env` (it points there through `host.docker.internal`), and the other examples to `env/*.env` with local values: a copy of the dev database (`CREATE DATABASE ceyliving_local TEMPLATE ceyliving`) through `host.docker.internal:15432`, `SITE_URL=http://localhost:3000`, generated secrets, `STORAGE_DRIVER=r2` with placeholder bucket values, and `EMAIL_DRIVER=resend` with a placeholder `re_…` key (production refuses `smtp`; sends will fail, which is fine locally).
2. `npm run docker:build` (the image `ceyliving:local`) and `npm run docker:build:backup`.
3. `CEYLIVING_IMAGE=ceyliving:local docker compose up -d`. `docker compose ps` shows no published ports. Without a real `TUNNEL_TOKEN` the tunnel restarts in a loop; everything else runs. To open a page, ask from inside the network: `docker compose exec web node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>r.text()).then(console.log)"`.
