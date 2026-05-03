# collab-server

Real-time collaboration backend for CodeCollab. Handles WebSocket-based document sync (Yjs CRDT), session CRUD, DynamoDB persistence, S3 edit history, and Redis Pub/Sub for horizontal scaling.

**Owner:** Yash Jain

## Architecture

```
Browser (y-websocket client)
    │
    ▼  WebSocket
┌──────────────────────────────────────────────┐
│  server.ts                                   │
│  ├── Express (HTTP API)                      │
│  │   ├── GET  /health                        │
│  │   ├── POST /api/sessions                  │
│  │   ├── GET  /api/sessions/:id              │
│  │   ├── POST /api/sessions/:id/duplicate    │
│  │   ├── POST /api/run          (mock)       │
│  │   └── POST /api/translate    (mock)       │
│  │                                           │
│  └── WebSocketServer                         │
│      └── y-websocket setupWSConnection       │
│          ├── bindState  → DynamoDB load       │
│          ├── on update  → S3 append + Redis   │
│          └── writeState → DynamoDB flush      │
└──────────┬──────────────┬────────────────────┘
           │              │
     ┌─────▼─────┐  ┌────▼─────┐
     │  DynamoDB  │  │  Redis   │
     │  Sessions  │  │  Pub/Sub │
     │  table     │  │  + TTL   │
     └───────────┘  └──────────┘
           │
     ┌─────▼─────┐
     │    S3     │
     │ Edit logs │
     └───────────┘
```

### How sync works

1. Client connects via WebSocket to `ws://{host}/{sessionId}`
2. y-websocket's `setupWSConnection` creates a `WSSharedDoc` (Yjs CRDT document) for the session
3. `bindState` loads the last compacted state from DynamoDB and applies it to the doc
4. Every edit from any client is relayed to all other connected clients by y-websocket
5. Each edit is also appended to S3 (edit history) and published to Redis (cross-server sync)
6. When the last client disconnects, `writeState` flushes the compacted state back to DynamoDB
7. Redis subscriptions are cleaned up on room close

### Horizontal scaling

Multiple Fargate tasks can run this server behind an ALB. Redis Pub/Sub ensures edits on one server reach clients on another. No sticky sessions required.

## Source files

| File | Responsibility |
|---|---|
| `server.ts` | Express + WebSocket server, y-websocket `setPersistence` hook, presence heartbeat |
| `persistence.ts` | DynamoDB operations: load/save Yjs state (`UpdateItem`), create/get session metadata |
| `sessions.ts` | Express router: session create, read, duplicate |
| `editlog.ts` | S3 append-only edit log (incremental Yjs updates keyed by sessionId) |
| `redis.ts` | Redis Pub/Sub adapter for cross-server sync + presence TTL keys |
| `logger.ts` | Pino logger (pretty in dev, structured JSON in production) |

## API

All responses follow the shape `{ success: boolean, data?: T, error?: string }`.

### POST /api/sessions

Create a new session.

```json
// Request
{ "name": "my-project", "language": "python", "ownerId": "uuid" }

// Response 201
{ "success": true, "data": { "sessionId": "uuid", "name": "my-project", "language": "python", ... } }
```

### GET /api/sessions/:id

Retrieve session metadata.

```json
// Response 200
{ "success": true, "data": { "sessionId": "uuid", "name": "...", "language": "...", ... } }

// Response 404
{ "success": false, "error": "Not found" }
```

### POST /api/sessions/:id/duplicate

Clone a session (document state + metadata).

```json
// Request
{ "newName": "my-fork", "ownerId": "uuid" }

// Response 201
{ "success": true, "data": { "sessionId": "new-uuid", ... } }
```

### WebSocket /ws/{sessionId}

Yjs sync protocol. Connect with a y-websocket `WebsocketProvider`:

```ts
const provider = new WebsocketProvider("ws://localhost:8000", sessionId, ydoc)
```

### GET /health

```json
{ "status": "ok", "timestamp": "2026-05-01T..." }
```

## DynamoDB schema

Table: `codecollab-sessions` (partition key: `sessionId`)

| Attribute | Type | Description |
|---|---|---|
| `sessionId` | S | UUID v4 (partition key) |
| `name` | S | Session display name |
| `language` | S | `python` or `javascript` |
| `ownerId` | S | UUID of the creator |
| `isPublic` | BOOL | Visibility flag |
| `yjsState` | B | Compacted Yjs binary (written on last-client disconnect) |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |

`saveSessionState` uses `UpdateItem` (not `PutItem`) so that flushing `yjsState` does not overwrite session metadata.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP + WebSocket listen port |
| `NODE_ENV` | — | `production` disables pino-pretty |
| `LOG_LEVEL` | `info` | Pino log level |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `AWS_REGION` | `us-east-1` | AWS region |
| `AWS_ENDPOINT_URL` | — | LocalStack endpoint for local dev |
| `DYNAMODB_TABLE_SESSIONS` | `codecollab-sessions-dev` | DynamoDB table name |
| `S3_BUCKET_LOGS` | `codecollab-edit-logs-dev` | S3 bucket for edit history |
| `CORS_ORIGINS` | — (allow all) | Comma-separated allowed origins for production |

## Local development

Prerequisites: Docker (for Redis and LocalStack).

```bash
# 1. Start dependencies
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name localstack -p 4566:4566 -e SERVICES=dynamodb,s3 localstack/localstack:3.8

# 2. Create DynamoDB table and S3 bucket
aws --endpoint-url=http://localhost:4566 dynamodb create-table \
  --table-name codecollab-sessions-dev \
  --attribute-definitions AttributeName=sessionId,AttributeType=S \
  --key-schema AttributeName=sessionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-east-1

aws --endpoint-url=http://localhost:4566 s3 mb s3://codecollab-edit-logs-dev --region us-east-1

# 3. Install dependencies (from monorepo root)
npm install

# 4. Start the dev server
cd collab-server
npm run dev
```

The server starts on `http://localhost:8000`. WebSocket connections go to `ws://localhost:8000/{sessionId}`.

## Docker

Build context is the **monorepo root** (needed for the workspace lockfile):

```bash
# From codecollab/
docker build -f collab-server/Dockerfile -t codecollab-collab-server .
```

Multi-stage build: compiles TypeScript in the build stage, copies only production deps and compiled JS to the final `node:20-slim` image. Runs as non-root `node` user.

## ECR

Image: `212208751162.dkr.ecr.us-east-1.amazonaws.com/codecollab/collab-server:latest`

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 212208751162.dkr.ecr.us-east-1.amazonaws.com

docker tag codecollab-collab-server:latest \
  212208751162.dkr.ecr.us-east-1.amazonaws.com/codecollab/collab-server:latest

docker push 212208751162.dkr.ecr.us-east-1.amazonaws.com/codecollab/collab-server:latest
```

## Design notes

**Why `setPersistence` instead of a custom RoomManager?**
y-websocket's `setupWSConnection` creates and manages its own `WSSharedDoc` instances internally. A separate `RoomManager` creating its own `Y.Doc` results in two disconnected documents — edits go through y-websocket's doc but persistence is attached to a different one. `setPersistence` hooks directly into y-websocket's doc lifecycle.

**Why CJS `require("yjs")` instead of ESM `import`?**
The project is ESM (`"type": "module"`), but `y-websocket/bin/utils.js` is CJS and does `require('yjs')`. ESM and CJS imports of the same package load two separate module instances in Node.js. Using `createRequire` + `require("yjs")` everywhere ensures a single Yjs instance shared with y-websocket.

**Why `UpdateItem` for `saveSessionState`?**
`PutItem` replaces the entire DynamoDB row. When flushing `{sessionId, yjsState, updatedAt}`, it would wipe `name`, `language`, `ownerId`, etc. `UpdateItem` only touches the specified attributes.
