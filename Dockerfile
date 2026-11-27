# Base images: Chainguard node (built on Wolfi). Debian 13 distroless carried 56
# OS CVEs that Debian marks affected / fix_deferred (no fix available), which the
# all-severities gate cannot accept. Chainguard rebuilds continuously for near-zero
# CVEs and signs every image with Cosign; container-security.yml verifies those
# signatures before building. The free tier only publishes :latest and :latest-dev
# of the plain node image (node-lts needs a paid account), which track the newest
# Node.js release (26.13.1 at these digests); CI tests on the same major.
# Pinned by digest so a rebuild cannot silently pick up a different image;
# Dependabot (docker ecosystem) proposes digest updates, which go through the
# same scans, signature check and container test as any other change.

# Stage 1: install production dependencies (the -dev variant has npm and a shell).
FROM cgr.dev/chainguard/node:latest-dev@sha256:6b4750c1dcc90d5d7f56fa7c3b0dcb4cc46702f2764ae388c0e7d2ccf8f56f02 AS deps

WORKDIR /app

COPY --chown=node:node package*.json ./

# Production dependencies only; no package install scripts run during the build.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# Stage 2: minimal runtime image (no shell, no package manager; entrypoint is node)
FROM cgr.dev/chainguard/node:latest@sha256:74b28494d25c04046835cf2ebb354c992129f9c73a633f051090889d14e0b6f6 AS runtime

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
