# Stage 1: install production dependencies
FROM node:25-trixie-slim AS deps

WORKDIR /app

COPY package*.json ./

# Production dependencies only; no package install scripts run during the build.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# Stage 2: minimal runtime image (no shell, no package manager)
# Debian 13: Debian 12 distroless still shipped libssl3 3.0.18 (CVE-2026-31789).
FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY app ./app
COPY config ./config
COPY artifacts/db-reset.js ./artifacts/

# Production mode: the app refuses to start without SESSION_SECRET and CRYPTO_KEY.
ENV NODE_ENV=production

USER 65532

EXPOSE 4000

CMD ["server.js"]
