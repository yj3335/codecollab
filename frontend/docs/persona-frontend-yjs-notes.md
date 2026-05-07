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

Deployed environment for the persona demo:

- **Public URL**: <https://d2ueiwejqy54yr.cloudfront.net>
- **AWS account / region**: 209292847448 / us-east-1
- **CloudFront distribution**: E16W4VX5Y06SC2
- **CloudWatch dashboard**: <https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=codecollab-dashboard>

The full 3-minute click-through with fallbacks lives in
[`docs/demo-script.md`](../../docs/demo-script.md). Persona-relevant beats:

1. **Two-tab collaborative edits with live sync.** Open the public URL in a
   normal Chrome window and a private/incognito window so they get distinct
   `display_name`/`ownerId` from `localStorage`. Confirm cursor color labels
   and live `Y.Text` propagation when typing in either window.
2. **Per-user undo / redo.** Type in window A, press `Ctrl+Z`. Only A's
   recent ops should revert; window B's edits are untouched (Yjs
   `UndoManager` scoped to the local client).
3. **Run output stream with `CODECOLLAB_IMAGE:` inline render.** Use the
   matplotlib snippet from `docs/demo-script.md` (Beat 3) so the inline PNG
   sentinel exercises the `OutputPanel` image renderer end-to-end.
4. **Language picker + Run JavaScript.** Switch the SessionBar language
   `<select>` to JavaScript, paste `console.log([1,2,3,4].map(x => x*x))`,
   click Run, and confirm `[1, 4, 9, 16]` arrives over the WebSocket stream.
   The PATCH to `/api/sessions/<id>` and the JS runner image both light up.
5. **Translate -> diff -> accept path with language flip.** Translate the
   Python snippet to JavaScript, show the explanation under the diff, click
   Accept, and confirm the SessionBar language picker flips and the editor
   content swaps. Re-Run to prove the new language works.
6. **Session-not-found resilience.** Visit
   `https://d2ueiwejqy54yr.cloudfront.net/s/does-not-exist-xyz` to demo the
   `Session not found` banner and `Create new session` CTA without leaving
   the SPA.
7. **WebSocket reconnect.** Toggle the network tab to offline for ~5 s and
   back; the connection-status pill should turn red, then green, and edits
   from the offline window should replay once reconnected.
