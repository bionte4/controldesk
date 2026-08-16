# syntax=docker/dockerfile:1.7
# ControlDesk — production Dockerfile per rules §2.
# Multi-stage build against Node 20 Alpine producing a Next.js standalone bundle.

# -----------------------------------------------------------------------------
# Stage 1: base — pinned Node runtime + system deps + Corepack (pnpm).
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat curl \
  && corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# -----------------------------------------------------------------------------
# Stage 2: deps — install *all* dependencies (dev + prod) from lockfile.
# `NODE_ENV` is unset here (the base stage sets it to `production` for
# the runtime image, but with that value pnpm skips devDependencies —
# Turbopack + Tailwind v4 + PostCSS all live in devDependencies).
# -----------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# -----------------------------------------------------------------------------
# Stage 3: builder — compile the Next.js standalone bundle.
# -----------------------------------------------------------------------------
FROM base AS builder
# Next.js production build wants NODE_ENV=production so it emits the
# optimised bundle; keep the base stage's value here. The devDependencies
# copied from `deps` are still resolvable because pnpm materialises them
# under node_modules/ regardless of the env var.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public build-time env — the runtime container also gets these; they are
# baked into the client bundle at build time and cannot be changed later.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_APP_NAME
# VAPID public key baked in at build time — see Web Push docs in
# `src/lib/push/send.ts`. Public keys are safe to bundle client-side.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_ROOT_DOMAIN=${NEXT_PUBLIC_ROOT_DOMAIN} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

# Skip the redundant in-Next `tsc --noEmit` pass during the Docker image
# build — Next.js 16 Turbopack regularly hangs that step in the 4 GB
# Docker Desktop VM. Full typecheck is still enforced in CI
# (`.github/workflows/ci.yml`) and locally before commit, so this only
# affects the image bake path. See `next.config.ts` for the conditional
# wiring. (Next.js 16 dropped built-in ESLint from `next build`, so
# there is no separate lint bypass needed here.)
ENV NEXT_SKIP_TYPECHECK=1

# BuildKit cache mount for `.next/cache` — Turbopack's persistence layer.
# Without this, every rebuild recompiles ~500 modules from scratch
# (~10 min in a 4 GB Docker Desktop VM). With the mount, only files
# touched since the previous build get re-transformed, cutting incremental
# rebuilds to 2-4 min. The cache is BuildKit-managed and never lands in
# the final image, so image size is unchanged. Docs:
# https://docs.docker.com/build/cache/optimize/#use-cache-mounts
# The `id=` scope keeps this cache separate from other projects on the
# same BuildKit builder. Combined with the pnpm-store mount in `deps`
# stage, first-time builds warm the cache; subsequent builds reuse both.
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

# -----------------------------------------------------------------------------
# Stage 4: runner — minimal runtime image, non-root user, healthcheck.
# -----------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# Create a locked-down system user to run the Next.js server.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

ENV HOSTNAME=0.0.0.0 \
    PORT=3000

# Rules §2 healthcheck. `/api/health` returns 200 when the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
