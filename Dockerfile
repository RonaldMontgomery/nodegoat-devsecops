# Base images: Chainguard node-lts (built on Wolfi). Debian 13 distroless carried 56
# OS CVEs that Debian marks affected / fix_deferred (no fix available), which the
# all-severities gate cannot accept. Chainguard rebuilds continuously for near-zero
# CVEs and signs every image with Cosign; container-security.yml verifies those
# signatures before building. The free tier only publishes :latest and :latest-dev,
# which track the newest Node.js LTS.
# TEMPORARY: unpinned until the first CI build reports the digests, then pinned
# by digest (Dependabot keeps them current) and these DL3007 ignores are removed.

# Stage 1: install production dependencies (the -dev variant has npm and a shell).
# hadolint ignore=DL3007
FROM cgr.dev/chainguard/node-lts:latest-dev AS deps

WORKDIR /app

COPY --chown=node:node package*.json ./

# Production dependencies only; no package install scripts run during the build.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# Stage 2: minimal runtime image (no shell, no package manager; entrypoint is node)
# hadolint ignore=DL3007
FROM cgr.dev/chainguard/node-lts:latest AS runtime

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
