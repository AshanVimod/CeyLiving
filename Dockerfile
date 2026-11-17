# syntax=docker/dockerfile:1.7
# B14 (backend plan 17.2): one image for the web app, the worker and the migrate step. Multi-stage: install, build
# (Next.js standalone output + the bundled worker), production dependencies, then a small runtime that runs as the
# unprivileged `node` user. How to build and run it: docs/runbook.md.
#
# The build prerenders pages, so it needs a migrated, reachable database and the production settings `next build`
# checks. They come in as a BuildKit secret (an env file, never a build argument or an image layer):
#   docker build --secret id=build_env,src=env/build.env --build-arg NEXT_DEPLOYMENT_ID=<commit> -t ceyliving:<tag> .
# The build database must be migrated with an EMPTY catalogue (no seed): Next serves a page prerendered at build time
# once more after every start, so no item, shop or demo data may be baked in (docs/runbook.md, "How it runs").

ARG NODE_IMAGE=node:22.23.4-bookworm-slim

# ---------- deps: every dependency, for the build ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
COPY package.json package-lock.json ./
# No install scripts: `prepare` (Husky) needs a git checkout. Prisma's engines and client are set up below.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---------- build: next build (standalone) and the worker bundle ----------
FROM deps AS build
COPY . .
ARG NEXT_DEPLOYMENT_ID=""
ENV NODE_ENV=production
RUN --mount=type=secret,id=build_env,required=true \
    npx prisma generate \
 && set -a && . /run/secrets/build_env && set +a \
 && NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID}" npm run build \
 && npm run build:worker

# ---------- prod-deps: production node_modules for the worker and the migrate step ----------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /src
ENV CHECKPOINT_DISABLE=1
# Prisma picks the schema engine build by the OpenSSL it finds, so this stage needs the runtime's OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Only @prisma/engines' install script is needed (it fetches the schema engine `prisma migrate deploy` uses).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm rebuild @prisma/engines \
 && npm cache clean --force

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
# openssl: Prisma's schema engine checks for it. Nothing else is installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    HOME=/tmp PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app

# The web app: Next's standalone server with its traced dependencies and static files. (No public/ folder: images
# come from R2 and seed photos from a CDN.)
COPY --from=build /src/.next/standalone ./web
COPY --from=build /src/.next/static ./web/.next/static

# The worker and operations commands (bundled), with production node_modules, the migrations and Prisma's config.
COPY --from=prod-deps /src/node_modules ./ops/node_modules
COPY --from=build /src/dist ./ops/dist
COPY --from=build /src/package.json /src/prisma.config.ts ./ops/
COPY --from=build /src/prisma ./ops/prisma
COPY infra/deploy/migrate.sh infra/deploy/warm.mjs ./ops/
# The compose file this image was built with: deploy.sh checks the server's copy against it.
COPY docker-compose.yml ./deploy/docker-compose.yml

# Everything above belongs to root and can't be changed by the app. Only Next's page cache is writable by `node`
# (.next/server/route-cache holds regenerated pages, .next/cache the rest); the worker and migrate containers run
# with a read-only file system.
RUN mkdir -p ./web/.next/server/route-cache ./web/.next/cache \
 && chown node:node ./web/.next/server/route-cache ./web/.next/cache

ARG NEXT_DEPLOYMENT_ID=""
LABEL org.opencontainers.image.revision="${NEXT_DEPLOYMENT_ID}"

USER node
WORKDIR /app/web
EXPOSE 3000
CMD ["node", "server.js"]
