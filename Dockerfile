# ---- deps stage (prod deps only) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Native build deps (needed for better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# ---- build stage (includes dev deps to build) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8521
# Explicit data directories (works in container + non-container)
ENV SIMPLEAIDE_DATA_DIR=/app/.simpleaide
ENV SIMPLEAIDE_PROJECTS_DIR=/app/projects

# Copy production deps from deps stage (no recompilation here)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/shared ./shared
COPY --from=build /app/package*.json ./

# Create writable dirs and own them
RUN mkdir -p /app/.simpleaide /app/projects \
  && chown -R node:node /app

USER node

EXPOSE 8521

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:8521/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
