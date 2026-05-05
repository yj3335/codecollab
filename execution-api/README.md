# execution-api

## Week 2 Scope

- Replace the local Docker stub with real ECS `RunTask`
- Stream stdout/stderr from CloudWatch Logs through the WebSocket endpoint
- Upload code to S3 when payloads exceed 4 KB
- Support image output through `CODECOLLAB_IMAGE`
- Verify timeout, memory, network, uid, and read-only-root behavior

## Implemented Endpoints

- `POST /api/run`
  Returns the final `RunResult` after execution completes.
- `POST /api/run/async`
  Starts execution in the background and returns a `runId` plus stream/status URLs.
- `GET /api/run/:runId`
  Returns `202` while a run is in progress, `200` with the final `RunResult` when complete, or `500` if the run failed.
- `GET /api/sessions/:sessionId/runs`
  Returns in-memory run history for the current process.
- `WS /api/run/:runId/stream`
  Streams `start`, `stdout`, `stderr`, `complete`, and `error` events.

## Notes

- `POST /api/run` preserves the original synchronous contract for callers that want a final result in one response.
- `POST /api/run/async` exists so clients can open the WebSocket stream immediately and receive live output while the task is running.
- Session run history is currently process-local and resets when the service restarts.
- ECS execution is guarded by `EXPECTED_AWS_ACCOUNT_ID` and will refuse to run if the active AWS identity belongs to a different account.

## Verification

Run the local execution verification suite with:

```bash
npm run verify:local-runner --workspace=execution-api
```

This script rebuilds the Python runner image and verifies:

- timeout enforcement
- bounded memory limit via cgroup inspection
- outbound network isolation
- runner uid `1000`
- read-only root filesystem behavior
