# Build context: monorepo root (codecollab/)
# Build command: docker build -f execution-api/Dockerfile -t codecollab-execution-api .

# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./tsconfig.json
COPY collab-server/package.json ./collab-server/
COPY frontend/package.json ./frontend/
COPY execution-api/package.json ./execution-api/
COPY translation/package.json ./translation/
COPY infra/package.json ./infra/

RUN npm ci --workspace=execution-api

COPY execution-api/tsconfig.json ./execution-api/
COPY execution-api/src/ ./execution-api/src/
COPY shared/types.ts ./shared/types.ts

RUN npm run build --workspace=execution-api

# ---- Production stage ----
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8001

COPY package.json package-lock.json ./
COPY tsconfig.json ./tsconfig.json
COPY collab-server/package.json ./collab-server/
COPY frontend/package.json ./frontend/
COPY execution-api/package.json ./execution-api/
COPY translation/package.json ./translation/
COPY infra/package.json ./infra/

RUN npm ci --workspace=execution-api --omit=dev && npm cache clean --force

COPY --from=build /app/execution-api/dist ./execution-api/dist

USER node

EXPOSE 8001

CMD ["node", "execution-api/dist/execution-api/src/server.js"]
