# Stage 1: install production dependencies
FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package*.json ./

# Production dependencies only; no package install scripts run during the build.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# Stage 2: minimal runtime image (no shell, no package manager)
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

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
