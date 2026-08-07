# AI-IMG-02 Production UX Acceptance

AI-IMG-02 closes the engineering acceptance surface for Image production controls, limits, quality selection,
mobile layout, accessibility, duplicate suppression, recovery, failure handling, and rollback. It does not approve a
real Provider for production.

## Automated evidence

- `config/image-production-ux-acceptance.json` keeps the machine-readable production decision at `no_go`.
- Image Studio exposes the capability contract's `low`, `medium`, and `high` quality options and sends the selected
  value through the application API. The prompt, quality control, status, and history expose explicit accessibility
  semantics.
- `server/src/creative/imageProductionAcceptance.test.js` proves closed quality mapping, one-output and prompt limits,
  per-job and daily budget guards, and staging-client rollback without network dispatch or Mock fallback.
- The focused server gate also runs generation execution concurrency/idempotency/recovery and Provider timeout/failure
taxonomy tests. Playwright proves high-quality request mapping, keyboard generation, internal history scrolling, and
no page overflow at 390x844.

## Database pricing and reconciliation

- Model Control stores nine output-price units covering all supported size/quality combinations plus text-input,
  image-input, and image-output Token units. Every row has its own version, effective window, deployment scope, and
  immutable database identity.
- Runtime routing selects the exact output price for the request and passes the complete active component-price set to
  the Image adapter. The generation references the selected price version and the Provider ledger stores an immutable
  pricing snapshot, so later price changes do not rewrite history.
- Provider usage is priced only when all required Token components are present. Missing prices or incomplete usage stay
  `reconciliation_required`; they are never shown as zero or as a successful settlement.
- Image Studio shows the database estimate before generation and the safe ledger estimate/actual state afterward.
  Existing protected Admin reconciliation actions remain the only manual settlement path and retain hashed evidence,
  permissions, and audit records.

Run the focused gate with:

```sh
npm run test:image-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the complete Playwright suite remains part of `check:pr`.

## Production decision

Production remains fail-closed. A go decision requires AI-IMG-01 credentialed real staging acceptance, scoped and
unexpired production approval, approved safety/data/legal evidence, monitored Provider controls, and an operator-owned
rollback rehearsal. Engineering acceptance is necessary evidence, not production authorization.
