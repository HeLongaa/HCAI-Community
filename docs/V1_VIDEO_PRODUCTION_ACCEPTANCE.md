# AI-VIDEO-02 Production UX Acceptance

AI-VIDEO-02 closes the engineering acceptance surface for Video latency, private preview, clean download, failure
recovery, limits, mobile accessibility, and rollback. It does not approve a real Provider for production.

## Automated evidence

- `config/video-production-ux-acceptance.json` keeps the machine-readable production decision at `no_go`.
- `server/src/creative/videoProductionAcceptance.test.js` proves duration/output/lifecycle and spend limits, daily budget
  blocking before dispatch, and Router staging-client rollback without network dispatch or automatic fallback.
- The fixture application acceptance is bounded to five seconds. Video lifecycle tests prove queued/running progression,
  completion and accounting, timeout compensation, retry exhaustion, failure closeout, explicit unsupported Router cancellation, and
  partial replay recovery.
- Active Model Control pricing versions now drive Router Video estimates and settlement using `generated_seconds`.
  The selected price id, effective window, unit price, and hash are preserved in the immutable reservation snapshot.
  When Router omits USD cost, successful 4/6/8-second jobs settle from that snapshot exactly once. Missing, expired,
  incompatible, or tampered pricing remains `reconciliation_required`; the system never invents an amount.
- The Admin model-control UI exposes currency, billing unit, micro-unit price, effective dates, deployment scope, status,
  and activation/disable controls. All changes use the existing model-control permissions and audit trail.
- Playwright proves application-owned clean MP4 private preview and download, keyboard generation, internal history
  scrolling, and no page overflow at 390x844. Preview, download, prompt, and status controls have explicit accessible
  names or live semantics.

Run the focused gate with:

```sh
npm run test:video-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the complete Playwright suite remains part of `check:pr`.

## Production decision

Production remains fail-closed. AI-VIDEO-01 credentialed HCAI Router staging, private-content ingestion, and database-
versioned automatic cost reconciliation are complete. A go decision still requires an online production environment,
scoped and unexpired production approval, confirmation that the configured price is contractually authoritative,
safety/legal/data terms, monitored Provider controls, and an operator-owned rollback rehearsal. Engineering and
staging acceptance are necessary evidence, not production authorization.
