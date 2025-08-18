# Multi-stage Dockerfile for Node.js Photo Manager
# Builder stage: install deps and build frontend
FROM node:22-bookworm-slim AS builder

# Install build tools for native modules (better-sqlite3) and libvips for sharp
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    git \
    pkg-config \
    libvips-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server deps first for better layer caching
COPY package*.json ./
RUN npm ci

# Install client deps
COPY client/package*.json ./client/
RUN cd client && npm ci

# Copy source and build
COPY . .
# Build frontend (outputs to client/dist/)
RUN npm run build

# Prune dev deps to reduce final image size
RUN npm prune --omit=dev

# Runtime stage
FROM node:22-bookworm-slim AS runtime

# Install only runtime dependencies (libvips) for sharp
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvips \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

# Copy built app and production node_modules
COPY --from=builder /app /app

# Ensure public dir exists and contains the built client
# server.js serves from "public"; copy Vite build output there
RUN mkdir -p public \
  && if [ -d "client/dist" ]; then rm -rf public && cp -r client/dist public; fi \
  && mkdir -p .projects

# Use non-root user for better security
USER node

EXPOSE 5000

# Basic healthcheck hitting the config endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||5000) + '/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
