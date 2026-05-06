# CodeCollab frontend

React (Create React App) client for collaborative editing: Monaco + Yjs, session management, code execution output, and translation diff. It lives in the monorepo under `frontend/`.

## Stack

- React 18, TypeScript, React Router
- Monaco (`@monaco-editor/react`), Yjs, `y-websocket`, `y-monaco`
- Axios for HTTP

## Prerequisites

- Node.js 18+ and npm 9+ (match the monorepo root)
- Running **collab-server** (default `http://localhost:8000`, WebSocket on the same host/port)
- Running **execution-api** for **Run** (default `http://localhost:8001`)

## Setup

From the monorepo root (recommended, so workspaces resolve):

```bash
cd codecollab
npm install
```

Configure env vars for Create React App (only variables prefixed with `REACT_APP_` are exposed to the bundle):

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local if your ports or hosts differ
```

## Scripts

| Command | Description |
| -------- | ----------- |
| `npm run dev` | Start dev server (usually [http://localhost:3000](http://localhost:3000)) |
| `npm run build` | Production build into `frontend/build` |
| `npm test` | Jest / react-scripts test |
| `npm run lint` | ESLint on `src/` |

From the repo root you can also run:

```bash
npm run dev --workspace=frontend
```

## Environment variables

See [`.env.example`](.env.example) for copy-paste defaults.

| Variable | Purpose |
| -------- | ------- |
| `REACT_APP_COLLAB_API_URL` | REST base URL for sessions and translate (proxied or collab-server) |
| `REACT_APP_COLLAB_WS_URL` | WebSocket URL for Yjs (`ws://` + host/port, room name is the session id) |
| `REACT_APP_EXECUTION_API_URL` | Execution API for `POST /api/run` and the run WebSocket stream |
| `REACT_APP_DEFAULT_SESSION_NAME` | Default `name` when creating a session |
| `REACT_APP_DEFAULT_LANGUAGE` | Default language for new sessions |

Optional in the browser: set `localStorage.codecollab_display_name` for the label published over Yjs awareness.

## App behavior (high level)

- **Routes:** `/` redirects to `/s/<uuid>`; the workspace loads that session id.
- **New Session:** `POST /api/sessions` with `name`, `language`, `ownerId`, and optional `isPublic`; navigates to the returned session id.
- **Collaboration:** Yjs `WebsocketProvider` syncs the shared `Y.Text` field `content` with Monaco.
- **Run:** `POST` to execution-api, then WebSocket `/api/run/:runId/stream`; output supports lines prefixed with `CODECOLLAB_IMAGE:` for inline images.
- **Translate:** `POST /api/translate` on the collab base URL (or mock); **Accept** updates language via `PATCH /api/sessions/:id` and replaces editor content from the Yjs document.

## API contracts

The shared contract reference is [`../shared/contracts.md`](../shared/contracts.md). Change that document (and types) before relying on new endpoints in the UI.

## Project layout

```
frontend/
  public/
  src/
    components/   # SessionBar, EditorPanel, OutputPanel, TranslationDiffView
    hooks/        # useSession, useYjs, useExecution
    lib/          # api.ts, userIdentity.ts
```

## Troubleshooting

- **CORS or wrong port:** Align `REACT_APP_*` URLs with where collab-server and execution-api actually listen.
- **Run never streams:** Confirm execution-api is up and `REACT_APP_EXECUTION_API_URL` matches; the app expects the stream at `ws(s)://<execution-host>/api/run/<runId>/stream`.
- **Session create fails:** Collab-server requires `name`, `language`, and `ownerId`; the app generates and persists `ownerId` in `localStorage` under `codecollab_owner_id`.

## Week 3 artifacts

- CP-5 manual verification checklist: [`docs/week3-cp5-checklist.md`](docs/week3-cp5-checklist.md)
- Person A report notes: [`docs/persona-frontend-yjs-notes.md`](docs/persona-frontend-yjs-notes.md)
