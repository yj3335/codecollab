# CodeCollab API Contracts

This document defines the contracts between all services. Update here first before implementing changes.

## Collaboration Server Endpoints

### Create Session
```
POST /api/sessions
Body: { name: string, language: string, isPublic: boolean }
Response: { id, name, language, createdAt, updatedAt, ownerId, code, yDocState }
Status: 201
```

### Get Session
```
GET /api/sessions/:id
Response: { id, name, language, createdAt, updatedAt, ownerId, code, yDocState }
Status: 200
```

### List Sessions
```
GET /api/sessions?owner=:userId&limit=50&offset=0
Response: { sessions: SessionMetadata[], total: number }
Status: 200
```

### Duplicate Session
```
POST /api/sessions/:id/duplicate
Body: { newName: string }
Response: { id, name, language, createdAt, updatedAt, ownerId, code, yDocState }
Status: 201
```

### WebSocket Connection
```
WS /ws/:sessionId
Message type: { type: "sync", data: Uint8Array }
Message type: { type: "awareness", data: Uint8Array }
```

## Execution API Endpoints

### Run Code
```
POST /api/run
Body: { sessionId, code, language, stdin?, timeout? }
Response: { id, sessionId, code, language, stdout, stderr, exitCode, executionTime, timestamp }
Status: 200
```

### Stream Execution
```
WS /api/run/:runId/stream
Message type: { type: "start" | "stdout" | "stderr" | "complete" | "error", data, timestamp }
```

### Get Run History
```
GET /api/sessions/:sessionId/runs?limit=20&offset=0
Response: { runs: RunResult[], total: number }
Status: 200
```

## Translation API

### Request Translation
```
POST /api/translate
Body: { code, sourceLanguage, targetLanguage, sessionId }
Response: { id, sessionId, sourceLanguage, targetLanguage, originalCode, translatedCode, explanation?, timestamp }
Status: 200
Lambda function processes async
```

### Get Translation
```
GET /api/sessions/:sessionId/translations/:id
Response: { id, sessionId, sourceLanguage, targetLanguage, originalCode, translatedCode, explanation?, timestamp }
Status: 200
```

## Data Persistence

### DynamoDB Tables
- **Sessions**: PK=id, SK=ownerId, GSI on isPublic
- **RunResults**: PK=id, SK=sessionId, TTL=30 days
- **Translations**: PK=id, SK=sessionId, TTL=30 days
- **EditLogs**: PK=sessionId, SK=timestamp (S3 backed)

### S3 Buckets
- **code-sessions**: Session code backups
- **edit-logs**: Timestamped edit history
- **execution-logs**: CloudWatch log exports

## Environment Variables

Each service requires:
```
STAGE=dev|prod
LOG_LEVEL=debug|info|warn|error
```

Collab Server:
```
REDIS_URL=redis://...
DYNAMODB_TABLE_SESSIONS=codecollab-sessions-{stage}
S3_BUCKET_LOGS=codecollab-edit-logs-{stage}
```

Execution API:
```
ECS_CLUSTER=codecollab-cluster-{stage}
ECS_TASK_DEFINITION=codecollab-runner-{stage}
```

Translation:
```
GEMINI_API_KEY=...
```

## Error Responses

All services return error responses in this format:
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
- 500: Internal Server Error
- 503: Service Unavailable

## Rate Limiting

- Global: 100 requests per minute per IP
- Per session: 50 executions per minute
- Translation API: 10 requests per minute per user
