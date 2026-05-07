# CP-5 Manual Checklist (Frontend / Yatharth)

Use this checklist during integration and demo rehearsal.

## Deployed environment

- **Public URL**: <https://d2ueiwejqy54yr.cloudfront.net>
- **AWS account**: 209292847448 / us-east-1
- **ALB DNS** (internal reference): codecollab-alb-605270909.us-east-1.elb.amazonaws.com
- **CloudFront distribution**: E16W4VX5Y06SC2
- **CloudWatch dashboard**: <https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=codecollab-dashboard>

## Preconditions

- All five CDK stacks (Network, Data, Compute, Frontend, Observability) are
  deployed and `CREATE_COMPLETE`.
- ECS services `collab-server` (desiredCount 2) and `execution-api`
  (desiredCount 1) are healthy on Fargate.
- Two browser windows/tabs are available for collaboration checks.
- Gemini API key in `codecollab/gemini-api-key` Secrets Manager secret is set
  to a real Gemini key (the placeholder will fail Translate with a 500).

## API smoke tests (CLI)

These were verified against the deployed CloudFront URL during the wrap-up:

| Probe                                                            | Expected | Observed (2026-05-07)            |
| ---------------------------------------------------------------- | -------- | -------------------------------- |
| GET `/`                                                          | 200 SPA  | 200 (CloudFront → S3)            |
| GET `/s/<random>`                                                | 200 SPA  | 200 (SPA fallback via 403→index) |
| POST `/api/sessions`                                             | 201 envelope | `success: true, data.sessionId` present |
| GET `/api/sessions/<unknown>`                                    | 404      | `{success:false, error:"Not found"}` |
| PATCH `/api/sessions/<id>` `{language:"javascript"}`             | 200      | `data.language === "javascript"` |
| WS upgrade `/ws/<sessionId>`                                     | 101      | HTTP/1.1 101 Switching Protocols |
| POST `/api/run/async` (python)                                   | 202 + runId | runId returned in <1s         |
| GET `/api/run/<runId>` after ~50s (python: `print("Hello from Fargate!")`) | 200 + stdout `"Hello from Fargate\n4\n"` | exitCode 0, executionTime ~53.6s |
| POST `/api/run/async` (javascript)                               | 202 + runId | runId returned in <1s         |
| GET `/api/run/<runId>` after ~50s (js: `console.log([1,2,3].map(x=>x*x).join(","))`) | 200 + stdout `"Hello from Node\n1,4,9\n"` | exitCode 0, executionTime ~50s   |
| POST `/api/translate` (placeholder secret)                       | 500 envelope | `{success:false, error:"Translation failed: Gemini API error 400: API key not valid"}` |

## End-to-end happy path (browser, two tabs)

- [ ] Open `<public-url>/s/{sessionId}` in tab A and tab B.
- [ ] Confirm both tabs show `connected` sync status within ~10 s.
- [ ] Type in tab A and confirm updates appear in tab B without refresh.
- [ ] Confirm awareness colors / cursors are different between tabs.
- [ ] Click `Run` with a small Python snippet; confirm streamed stdout appears
      in the OutputPanel within ~60 s (first run) and an `[exit 0 in N ms]`
      meta line at the end.
- [ ] Switch language picker to JavaScript; click `Run` with a `console.log`
      snippet; confirm output streams.
- [ ] Run Python that emits `CODECOLLAB_IMAGE:data:image/png;base64,...`
      (e.g., a matplotlib `savefig`) and confirm the PNG renders inline in
      the OutputPanel.
- [ ] Click `Translate` (after setting a real Gemini key); confirm diff opens
      with source/target labels and explanation.
- [ ] Click `Accept`; confirm editor content is replaced and the session bar
      language flips. Refresh the page; confirm the new language persists.
- [ ] Click `Copy Share URL`; paste in a new tab; confirm the same session
      loads.

## Error / resilience checks

- [ ] Open unknown session id (`<public-url>/s/does-not-exist`); confirm
      `Session not found` view with `Create new session` button.
- [ ] Click `Run` with empty editor; confirm friendly banner
      "Editor is empty. Add code before running."
- [ ] Click `Run` with a Python snippet that times out
      (`while True: pass`); confirm exit code 124 and a stderr line
      "Execution timed out…".
- [ ] Force translation failure (current default with placeholder secret);
      confirm in-app banner "Translation failed: …" and no content corruption
      in the editor.
- [ ] Click `Dismiss` in translation view; confirm original editor content
      remains unchanged.
- [ ] Stop one of the two collab-server tasks (`aws ecs update-service`
      with `--desired-count 1`); confirm one of the two browser tabs
      reconnects within ~30 s without losing edits, banner shows
      "Disconnected from collaboration server. Reconnecting automatically…"
      and clears once the connection is restored.

## Responsive / usability checks

- [ ] Verify controls remain usable at tablet width (~768 px).
- [ ] Verify controls remain usable at phone width (~390 px).
- [ ] Verify output panel remains scrollable and readable on narrow layouts.
- [ ] Verify session bar input / actions do not overflow.

## Sign-off criteria

- [ ] Happy path passes end-to-end against the deployed CloudFront URL with
      two browsers in different sessions / private windows.
- [ ] All failure states show friendly messages.
- [ ] No blocking UI regressions observed on mobile / tablet widths.
- [ ] CloudWatch dashboard shows traffic for active connections, execution
      durations, translation latency, and DynamoDB writes during demo run.
