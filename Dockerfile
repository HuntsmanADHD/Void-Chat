# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Void Chat — single image, two entry points.
#
# Build:  docker build -t voidchat .
# Run:    docker compose up        (recommended; see docker-compose.yml)
#
# The image bundles both the Next.js web app and the relay socket server.
# docker-compose runs two containers from the same image with different
# entry commands so the web and relay can fail/restart independently.
# ─────────────────────────────────────────────────────────────────────────────

# ── deps: install all production + build deps with yarn ────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY prisma ./prisma

# yarn 4 (Berry) — install everything (build needs dev deps).
RUN corepack enable && yarn install --immutable

# Generate the Prisma client now so the build stage can import it.
RUN yarn prisma generate

# ── builder: build Next standalone bundle ──────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY . .

RUN yarn build

# ── runner: minimal runtime image ──────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root for safety.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 voidchat

# Next.js standalone bundles its own minimal node_modules. Copy it.
COPY --from=builder --chown=voidchat:nodejs /app/.next/standalone ./
COPY --from=builder --chown=voidchat:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=voidchat:nodejs /app/public ./public

# Relay needs the source TS + tsx + nacl/bs58/socket.io. Standalone bundle
# doesn't include the relay or its deps, so copy a parallel runtime tree.
COPY --from=builder --chown=voidchat:nodejs /app/server ./server
COPY --from=builder --chown=voidchat:nodejs /app/src/types/wire.ts ./src/types/wire.ts
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/socket.io ./node_modules/socket.io
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/tweetnacl ./node_modules/tweetnacl
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/bs58 ./node_modules/bs58

# Prisma schema + generated client + CLI. We need the CLI (`node_modules/prisma`)
# because the web container runs `prisma db push --skip-generate` on every
# start — idempotent, creates SQLite tables on first boot, no-op on later boots.
COPY --from=builder --chown=voidchat:nodejs /app/prisma ./prisma
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=voidchat:nodejs /app/node_modules/prisma ./node_modules/prisma

USER voidchat

# data/ is a Docker-managed volume mount in compose. Pre-creating the
# directory here just means the path exists if someone runs the image
# without mounting anything.
RUN mkdir -p /app/data

# tini reaps zombies and forwards SIGTERM so `docker stop` is graceful.
ENTRYPOINT ["/sbin/tini", "--"]

# Default command runs Next after a no-op-on-rerun schema sync. Compose
# overrides this for the relay container (which doesn't need the schema).
# `exec` ensures node replaces sh, so signals reach node directly.
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && exec node server.js"]
