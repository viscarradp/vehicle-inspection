# ── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ─────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

WORKDIR /build/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
# Bundle everything into dist/server.js — mssql and sharp stay external (native)
RUN npx esbuild src/index.ts \
      --bundle \
      --platform=node \
      --target=node20 \
      --format=cjs \
      --outfile=dist/server.js \
      --external:mssql \
      --external:sharp

# ── Stage 3: Production runtime ────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild sharp || true

# Bundled server
COPY --from=backend-builder /build/backend/dist/server.js ./dist/server.js

# Built frontend
COPY --from=frontend-builder /build/frontend/dist ./public

# Persistent directories (uploads kept for local dev; in prod use GCS)
RUN mkdir -p uploads \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
