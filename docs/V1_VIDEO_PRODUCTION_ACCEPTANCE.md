# AI-VIDEO-02 Production UX Acceptance

AI-VIDEO-02 closes the engineering acceptance surface for Video latency, private preview, clean download, failure
recovery, limits, mobile accessibility, and rollback. It does not approve a real Provider for production.

## Automated evidence

- `config/video-production-ux-acceptance.json` keeps the machine-readable production decision at `no_go`.
- `server/src/creative/videoProductionAcceptance.test.js` proves duration/output/lifecycle and spend limits, daily budget
  blocking before dispatch, and Veo staging-client rollback without network dispatch or automatic fallback.
- The fixture application acceptance is bounded to five seconds. Video lifecycle tests prove queued/running progression,
  completion and accounting, timeout compensation, retry exhaustion, failure closeout, idempotent cancellation, and
  partial replay recovery.
- Playwright proves application-owned clean MP4 private preview and download, keyboard generation, internal history
  scrolling, and no page overflow at 390x844. Preview, download, prompt, and status controls have explicit accessible
  names or live semantics.

Run the focused gate with:

```sh
npm run test:video-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the complete Playwright suite remains part of `check:pr`.

## Production decision

Production remains fail-closed. A go decision requires AI-VIDEO-01 credentialed Google Cloud acceptance, scoped and
unexpired production approval, private GCS and safety/legal evidence, monitored Provider controls, and an operator-owned
rollback rehearsal. Engineering acceptance is necessary evidence, not production authorization.
