# =====================================================================
# NovaERP backend - production image
# =====================================================================
# Multi-stage build:
#   1. deps       - install full dev+prod deps so `prisma generate`
#                   and `tsc` can run.
#   2. build      - generate prisma client + compile TS -> dist/.
#   3. runtime    - slim node image with only prod deps + dist/ +
#                   prisma artefacts. Runs as non-root `node` user.
# =====================================================================

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Install build tooling for any native deps (bcryptjs is pure JS but
# better-sqlite3 / argon2 etc. could appear later).
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json* ./
# Use npm ci when a lock file is present, otherwise fall back to
# install so the image still builds for fresh checkouts.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma needs the schema present before generate; copy the whole
# tree first (cheap on alpine) then run.
RUN npx prisma generate \
 && npm run build \
 && npx tsc -p tsconfig.ops.json

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
# OpenSSL 3 is required by Prisma's query engine on alpine.
RUN apk add --no-cache openssl tini su-exec wget sqlite
# Copy only what runtime needs.
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# Drop dev deps to slim the image (re-install with --omit=dev). This
# keeps prisma cli + tsx out of the runtime image. The 5-10s
# extra reinstall here is dwarfed by the 80%+ image size win.
RUN npm prune --omit=dev \
 && npm install prisma@^5.22.0 --omit=dev --no-save

# Bundle product images as a seed. The uploads volume mounts at
# /app/uploads at runtime and shadows this directory, so we place
# images in /app/uploads-seed/ instead. The entrypoint copies them
# into the volume on first boot (when the volume is empty).
COPY uploads/ /app/uploads-seed/

# SQLite database lives in /data so a docker volume can persist it.
# We also keep the legacy /app/prisma/dev.db location working: the
# container's entrypoint symlinks it at boot if DATABASE_URL points
# at the volume.
RUN mkdir -p /data /app/uploads/products && chown -R node:node /data /app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
USER root

EXPOSE 4000
# Tini reaps zombies and forwards SIGTERM correctly so docker stop is
# graceful (Fastify handles SIGTERM out of the box).
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
