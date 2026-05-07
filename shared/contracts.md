# CodeCollab API Contracts

This document defines the contracts between all services. Update here first before implementing changes.

All HTTP responses follow the envelope `{ success: boolean, data?, error?, statusCode }`.

In deployed mode, all paths below are served from a single CloudFront origin which routes:

- `/` (default) -> S3 bucket containing the React build
- `/api/sessions*`, `/ws/*` -> ALB target group: collab-server
- `/api/run*` -> ALB target group: execution-api
- `/api/translate*` -> ALB target group: translation Lambda

## Collaboration Server Endpoints (port 8000)

### Health Check
```
GET /healthz
Response: { ok: true } (200)
```

### Create Session
```
POST /api/sessions
Body: { name: string, language: "python" | "javascript", ownerId: string, isPublic?: boolean }
Response envelope: { success: true, data: { sessionId, name, language, ownerId, isPublic, createdAt, updatedAt, expiresAt } }
Status: 201
```

### Get Session
```
GET /api/sessions/:sessionId
Response envelope: { success: true, data: { sessionId, name, language, ownerId, isPublic, createdAt, updatedAt, expiresAt } }
Status: 200 | 404
```

### Update Session (e.g. language after translation accept)
```
PATCH /api/sessions/:sessionId
Body: { language?: "python" | "javascript", name?: string, isPublic?: boolean }
Response envelope: { success: true, data: SessionMetadata }
Status: 200
```

### Duplicate Session
```
POST /api/sessions/:sessionId/duplicate
Body: { newName?: string }
Response envelope: { success: true, data: SessionMetadata }
Status: 201
```

### WebSocket Connection (Yjs sync + awareness)
```
WS /ws/:sessionId
Subprotocol: y-websocket binary frames
Awareness payload: { name, color } per client
```

## Execution API Endpoints (port 8001)

### Health Check
```
GET /healthz
Response: { ok: true } (200)
```

### Run Code (async kickoff)
```
POST /api/run
Body: { sessionId, code, language: "python" | "javascript", stdin?, timeout? }
Response envelope: { success: true, data: { runId, status: "queued" | "running" } }
Status: 202
```

### Stream Execution
```
WS /api/run/:runId/stream
Server -> client message: { type: "start" | "stdout" | "stderr" | "complete" | "error", data: string, timestamp: string }
Special line markers (within data of stdout):
  - CODECOLLAB_IMAGE:data:image/png;base64,<...>  (inline PNG produced by runner)
```

### Run Status (poll fallback)
```
GET /api/run/:runId
Response envelope: { success: true, data: { runId, status, stdout, stderr, exitCode?, executionTime? } }
Status: 200 | 202 | 404
```

### Run History (per session)
```
GET /api/sessions/:sessionId/runs?limit=20&offset=0
Response envelope: { success: true, data: { runs: RunResult[], total: number } }
Status: 200
```

## Translation API (Lambda behind ALB)

### Request Translation
```
POST /api/translate
Body: { code, sourceLanguage, targetLanguage, sessionId? }
Response envelope: { success: true, data: TranslationResult }
TranslationResult: { id, sessionId?, sourceLanguage, targetLanguage, originalCode, translatedCode, explanation?, timestamp }
Status: 200
```

Notes:
- Uses Gemini 2.5 Flash via Secrets Manager (`codecollab/gemini-api-key`).
- Retries 429/503 with backoff.
- Per-session in-memory rate limit (10 req/min).

## Data Persistence

### DynamoDB Tables
- **codecollab-sessions**: PK=`sessionId`, attributes include `name`, `language`, `ownerId`, `isPublic`, `yjsState` (Base64), `expiresAt` (TTL).

### ElastiCache Redis
- Pub/sub channel `yjs:{sessionId}` for cross-task Yjs updates and awareness relay.
- Presence keys `presence:{sessionId}:{clientId}` with TTL for live participants list.

### S3 Buckets
- `codecollab-edit-history-{account}`: Append-only edit log per session (one object per change batch).
- `codecollab-exec-staging-{account}`: Code/stdin payloads larger than `INLINE_CODE_THRESHOLD_BYTES`, fetched by runner via env vars.

## Environment Variables

Common to all services:
```
STAGE=dev|prod
LOG_LEVEL=debug|info|warn|error
AWS_REGION=us-east-1
```

Collab Server:
```
PORT=8000
CORS_ORIGINS=https://<cloudfront-domain>,http://localhost:3000
REDIS_URL=rediss://...
DYNAMODB_TABLE_SESSIONS=codecollab-sessions
S3_BUCKET_LOGS=codecollab-edit-history-<account>
```

Execution API:
```
PORT=8001
EXECUTION_MODE=ecs
ECS_CLUSTER=codecollab
ECS_PYTHON_TASK_DEFINITION=<arn>
ECS_NODEJS_TASK_DEFINITION=<arn>
ECS_RUNNER_CONTAINER_NAME=runner
ECS_SUBNET_IDS=<comma-separated>
ECS_SECURITY_GROUP_IDS=<comma-separated>
ECS_LOG_GROUP=/codecollab/runner
PYTHON_RUNNER_IMAGE=<ecr-uri>:latest
NODEJS_RUNNER_IMAGE=<ecr-uri>:latest
EXEC_STAGING_BUCKET=codecollab-exec-staging-<account>
RUNNER_TIMEOUT_SECONDS=15
INLINE_CODE_THRESHOLD_BYTES=4096
```

Translation Lambda:
```
GEMINI_SECRET_NAME=codecollab/gemini-api-key
```

## Error Responses

All services return error responses in this envelope:
```json
{
  "success": false,
  "error": "Human readable error message",
  "statusCode": 400
}
```

Standard status codes:
- 400: Bad Request (validation error)
- 401: Unauthorized (auth required)
- 403: Forbidden (permission denied)
- 404: Not Found
- 409: Conflict (duplicate resource)
- 429: Too Many Requests
- 500: Internal Server Error
- 503: Service Unavailable

## Rate Limiting

- Global: 100 requests per minute per IP (ALB-level, optional)
- Per session: 50 executions per minute (execution-api in-memory)
- Translation API: 10 requests per minute per session (Lambda in-memory)
