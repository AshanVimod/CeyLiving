#!/bin/sh
# B14 (17.2, DB-10): the one-off `migrate` container. Applies the Prisma migrations and installs or upgrades the job
# queue, both as the schema owner (DATABASE_MIGRATION_URL), before a new version of the web app and worker starts.
# Both steps only apply what is missing, so running it again is safe.
set -eu
cd /app/ops
node node_modules/prisma/build/index.js migrate deploy
node --conditions=react-server dist/jobs-migrate.mjs
