# Person A Report Notes: Frontend + Yjs UX

## Frontend ownership summary

- Session UX: create, share URL, connection status, and session-not-found handling.
- Collaborative editor UX: Monaco + Yjs synchronization with awareness labels and undo/redo.
- Execution UX: run requests, streamed output, error states, and inline plot rendering.
- Translation UX: translation diff, accept/dismiss behavior, and session language persistence.

## Key technical decisions

## 1) Collaboration model

- Use Yjs CRDT (`Y.Text`) bound to Monaco via `MonacoBinding`.
- Keep a single shared text field (`content`) per session.
- Publish local awareness user metadata (`name`, `color`) for presence display.

## 2) API shape normalization

- Client expects envelope responses (`{ success, data, error? }`) and unwraps centrally.
- Errors are normalized into typed `ApiError` categories (`not_found`, `network`, `timeout`, etc.) for consistent UX.

## 3) Run and output UX

- Run flow is two-step: `POST /api/run` then websocket stream by `runId`.
- Output parser handles regular stdout/stderr/meta and sentinel images.
- Empty/editor guardrails and retry affordance reduce user confusion.

## 4) Translation safety

- Translation opens in side-by-side diff first (no direct overwrite).
- `Dismiss` preserves editor text.
- `Accept` updates both session language (server PATCH) and editor document text.

## Known constraints and follow-ups

- Presence UX currently relies on Yjs awareness; richer heartbeat UI can be added if backend exposes user-level details.
- Timeout semantics depend on execution-api/backing runner configuration.
- Additional e2e browser automation can be added once CP-5 environment is stable.

## Demo checkpoints

- Two-tab collaborative edits with live sync.
- Run output stream with `CODECOLLAB_IMAGE:` inline render.
- Translate -> diff -> accept path with language flip.
- Session-not-found and failure banners for resilience demo.
