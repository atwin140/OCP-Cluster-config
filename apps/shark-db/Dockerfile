# =============================================================================
# Shark Database — Multi-stage Dockerfile
# =============================================================================
#
# Stages:
#   1. deps       — install all Node dependencies (cached layer)
#   2. builder    — build frontend (Vite) + backend (esbuild/tsx)
#   3. production — slim runtime image (no dev tools)
#
# OpenShift compatibility notes:
#   - Runs as non-root user (UID 1001 by default, but accepts any UID via
#     OpenShift's random UID enforcement — see USER and permission setup)
#   - Port 8080 used (unprivileged)
#   - No hardcoded UIDs that conflict with OpenShift SCC restricted policy
#   - Writable /tmp and /app/data for SQLite file; group-writable so
#     OpenShift's arbitrary UID can write to them
#   - Health endpoints at /api/health for liveness/readiness probes
#
# Build:
#   docker build -t shark-db:latest .
#
# Run locally:
#   docker run -p 8080:8080 \
#     -e PORT=8080 \
#     -e NODE_ENV=production \
#     shark-db:latest
#
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps needed for build)
RUN npm ci --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: Build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source files
COPY . .

# Build frontend (Vite) + backend (esbuild via tsx script/build.ts)
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: Production runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create a non-root user — but use group 0 (root group) so OpenShift's
# arbitrary UID assignment can still access files via group permissions.
# OpenShift runs containers with a random UID from the namespace's range
# but always assigns GID 0, so files owned by GID 0 are accessible.
RUN adduser -D -u 1001 -G root appuser && \
    chown -R 1001:0 /app && \
    chmod -R g=u /app

# Copy built artefacts from builder stage
COPY --from=builder --chown=1001:0 /app/dist ./dist
COPY --from=builder --chown=1001:0 /app/package.json ./package.json

# Install only production dependencies
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules

# Create a writable data directory for SQLite
# Group-writable so OpenShift's random UID (GID 0) can write here
RUN mkdir -p /app/data && \
    chown -R 1001:0 /app/data && \
    chmod -R g=u,g+w /app/data

# Also make /tmp writable (it already is by default, but being explicit)
RUN chmod 1777 /tmp

# Use non-root user
# OpenShift will override this UID with a random one; the GID 0 + group
# permissions above ensure the process can still write to /app/data
USER 1001

# Expose unprivileged port (OpenShift requires >1024 for restricted SCC)
EXPOSE 8080

# Health check — aligns with the /api/health readiness/liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

# Use dumb-init to properly handle PID 1 signal forwarding and zombie reaping
ENTRYPOINT ["dumb-init", "--"]

# Start the production server
# SQLite file will be written to /app/data/shark_db.sqlite
CMD ["node", "dist/index.cjs"]

# Environment variable defaults (override via ConfigMap / Secret in OpenShift)
ENV NODE_ENV=production \
    PORT=8080 \
    SQLITE_PATH=/app/data/shark_db.sqlite
