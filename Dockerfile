# syntax=docker/dockerfile:1.7

# ---- deps: install all node_modules (including dev, needed to build Next) ----
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS deps
WORKDIR /app/weatherV1-next
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- builder: compile Next.js, then prune to production deps ----
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS builder
WORKDIR /app/weatherV1-next
ENV NEXT_TELEMETRY_DISABLED=1
# Plaintext gate passwords consumed only by the prebuild hash-emit step.
# Build ARGs are not promoted to ENV in this stage, so the resulting
# image carries the hashes (in .next/) but never the plaintext.
ARG EDITOR_PASSWORD
ARG ADMIN_PASSWORD
ARG R2_APP_USERNAME
COPY --from=deps /app/weatherV1-next/node_modules ./node_modules
COPY . .
RUN EDITOR_PASSWORD="$EDITOR_PASSWORD" ADMIN_PASSWORD="$ADMIN_PASSWORD" R2_APP_USERNAME="$R2_APP_USERNAME" npm run build
RUN npm prune --omit=dev

# ---- runner: minimal runtime with ffmpeg + the built app ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app/weatherV1-next

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/weatherV1-next/runtime /app/v1Drive \
    && chown -R node:node /app

USER node

COPY --chown=node:node --from=builder /app/weatherV1-next/.next        ./.next
COPY --chown=node:node --from=builder /app/weatherV1-next/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/weatherV1-next/public       ./public
COPY --chown=node:node --from=builder /app/weatherV1-next/package.json ./package.json
COPY --chown=node:node --from=builder /app/weatherV1-next/next.config.ts ./next.config.ts

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/config" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/next", "start"]
