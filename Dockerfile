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

RUN pnpm run build

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
