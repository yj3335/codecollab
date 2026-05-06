# Week 3 CP-5 Manual Checklist (Person A)

Use this checklist during integration and demo rehearsal.

## Preconditions

- `collab-server` is reachable on `REACT_APP_COLLAB_API_URL`.
- `execution-api` is reachable on `REACT_APP_EXECUTION_API_URL`.
- Two browser windows/tabs are available for collaboration checks.

## End-to-end happy path

- [ ] Open `/s/{sessionId}` in tab A and tab B.
- [ ] Confirm both tabs show connected sync status.
- [ ] Type in tab A and confirm updates appear in tab B.
- [ ] Click `Run` with Python code; confirm output appears in panel.
- [ ] Run code that emits `CODECOLLAB_IMAGE:` and confirm inline image render.
- [ ] Click `Translate`; confirm diff opens with source/target labels.
- [ ] Click `Accept`; confirm editor content is replaced and language flips.

## Week 3 error and resilience checks

- [ ] Disconnect network or stop collab service; confirm reconnect/disconnected message appears.
- [ ] Open unknown session id (`/s/does-not-exist`); confirm session-not-found view appears.
- [ ] Click `Run` with empty editor; confirm friendly in-app message.
- [ ] Force execution timeout/failure; confirm readable error banner in output panel.
- [ ] Force translation failure; confirm readable in-app banner and no content corruption.
- [ ] Click `Dismiss` in translation view; confirm original editor content remains unchanged.

## Responsive and usability checks

- [ ] Verify controls remain usable at tablet width (~768px).
- [ ] Verify controls remain usable at phone width (~390px).
- [ ] Verify output panel remains scrollable and readable on narrow layouts.
- [ ] Verify session bar input/actions do not overflow.

## Sign-off criteria

- [ ] Happy path passes end-to-end.
- [ ] All failure states show friendly messages.
- [ ] No blocking UI regressions observed on mobile/tablet widths.
