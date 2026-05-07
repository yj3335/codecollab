# CodeCollab — 3-minute Demo Script

> Public URL: <https://d2ueiwejqy54yr.cloudfront.net>
>
> Run the demo from a Chrome window in normal mode + a second Chrome window
> in private/incognito mode (different `localStorage` so awareness colors and
> names differ). Open both at the SAME `/s/<sessionId>` URL.

## 0. Pre-flight (do this 5 minutes before)

- [ ] In a third tab, open the
      [CloudWatch dashboard](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=codecollab-dashboard)
      so panel updates are visible during the demo.
- [ ] Warm both ECS services with a throwaway Run so the demo Run finishes in
      ~3 s instead of ~50 s:
      ```bash
      curl -sS -X POST "https://d2ueiwejqy54yr.cloudfront.net/api/run/async" \
        -H 'content-type: application/json' \
        -d '{"sessionId":"warmup","code":"print(1)","language":"python"}'
      curl -sS -X POST "https://d2ueiwejqy54yr.cloudfront.net/api/run/async" \
        -H 'content-type: application/json' \
        -d '{"sessionId":"warmup","code":"console.log(1)","language":"javascript"}'
      ```
- [ ] Make sure `codecollab/gemini-api-key` Secrets Manager value is the real
      Gemini key (not the placeholder) for the Translate slide:
      ```bash
      aws secretsmanager update-secret \
        --secret-id codecollab/gemini-api-key \
        --secret-string '<paste-key>'
      ```

## Beat 1 — Architecture (30 s)

Open `README.md`. Point at:

- Single CloudFront origin → `/api/*` and `/ws/*` go to ALB; default goes to
  S3 SPA bucket.
- ALB path rules → collab-server (Yjs WS + sessions), execution-api (run +
  stream), translation Lambda.
- ECS Fargate runner pool — Python and Node images, started per-run via
  `RunTask`, log-driven streaming back to the API.

## Beat 2 — Real-time collaboration (45 s)

1. Open two browsers at the same `/s/<id>` URL.
2. Type a Python snippet in browser A. Confirm it appears in browser B
   instantly. Highlight the awareness color/name difference.
3. Hit Ctrl+Z in browser A — show the per-user undo history (Yjs
   `UndoManager`).
4. Refresh browser B — show the document is restored from DynamoDB.

## Beat 3 — Run code (45 s)

1. With the editor showing:
   ```python
   import matplotlib.pyplot as plt
   plt.plot([1,2,3,4],[1,4,9,16])
   plt.savefig('out.png')
   print("plot saved")
   ```
2. Click `Run`.
3. Show:
   - `start` meta line (ECS task launching),
   - streamed stdout (`plot saved`),
   - inline PNG image rendered from the `CODECOLLAB_IMAGE:` sentinel,
   - `[exit 0 in N ms]` meta line.
4. Switch the language picker to JavaScript, paste:
   ```javascript
   console.log([1,2,3,4].map(x => x*x));
   ```
   and click `Run`. Show output `[1, 4, 9, 16]`. Same flow, different runner
   image.

## Beat 4 — Translate (45 s)

1. Switch back to Python, paste:
   ```python
   nums = [x for x in range(10) if x % 2 == 0]
   print(sum(nums))
   ```
2. Click `Translate`.
3. Diff view opens. Highlight the source/target labels and the explanation
   text below the diff (Gemini-generated commentary about list comprehension
   → Array.filter / reduce).
4. Click `Accept`. Show the editor swaps to JavaScript, the language picker
   in the SessionBar updates, and clicking `Run` immediately works under the
   new language.

## Beat 5 — Resilience (15 s)

1. Open `https://d2ueiwejqy54yr.cloudfront.net/s/does-not-exist-xyz`.
2. Show the `Session not found` view with the `Create new session` CTA.
3. Click it; new uuid in the URL bar; clean editor.

## Beat 6 — Wrap (10 s)

Switch to the CloudWatch dashboard and point out:

- Active Connections (custom metric from collab-server),
- Execution P95 (ALB target response time + custom metric),
- Translation Lambda duration / errors,
- DynamoDB write latency.

## Fallback notes

- If a Run is slow, mention "first ECS task is a cold start; retries are
  ~3 s" and click `Retry` in the OutputPanel.
- If Translate fails with a 500, the placeholder Gemini key was not replaced;
  fall back to demoing two-tab Yjs sync + Run only.
- If CloudFront invalidation didn't propagate, hard-refresh with Cmd+Shift+R
  in each browser before starting.
