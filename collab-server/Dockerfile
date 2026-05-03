# Build context: monorepo root (codecollab/)
# Build command: docker build -f collab-server/Dockerfile -t codecollab-collab-server .

# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /app

# Copy root workspace files first (lockfile lives at root)
COPY package.json package-lock.json ./

# Copy all workspace package.json stubs so npm can resolve the full lockfile
COPY collab-server/package.json ./collab-server/
COPY frontend/package.json ./frontend/
COPY execution-api/package.json ./execution-api/
COPY translation/package.json ./translation/
COPY infra/package.json ./infra/

# Install only collab-server and its dependencies
RUN npm ci --workspace=collab-server

# Copy collab-server source and compile TypeScript
COPY collab-server/tsconfig.json ./collab-server/
COPY collab-server/src/ ./collab-server/src/

RUN npm run build --workspace=collab-server

# ---- Production stage ----
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

# Same workspace setup for production install
COPY package.json package-lock.json ./
COPY collab-server/package.json ./collab-server/
COPY frontend/package.json ./frontend/
COPY execution-api/package.json ./execution-api/
COPY translation/package.json ./translation/
COPY infra/package.json ./infra/

RUN npm ci --workspace=collab-server --omit=dev && npm cache clean --force

# Copy compiled JS from build stage
COPY --from=build /app/collab-server/dist ./collab-server/dist

# Non-root user for security
USER node

EXPOSE 8000

CMD ["node", "collab-server/dist/server.js"]
