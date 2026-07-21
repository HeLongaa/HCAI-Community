# AI-CHAT-02 Production UX Acceptance

AI-CHAT-02 closes the engineering acceptance surface for Chat quality, long conversations, bounded fixture load,
mobile layout, keyboard accessibility, and runtime rollback. It does not approve a real Provider for production.

## Automated evidence

- `config/chat-production-ux-acceptance.json` is the machine-readable acceptance contract and keeps the production
  decision at `no_go`.
- `server/src/chat/chatProductionAcceptance.test.js` proves that a 100-message conversation rejects the next turn
  before any Provider or classifier dispatch, runs 20 isolated conversations concurrently with completed generation
  accounting, and proves `openai_staging -> disabled` rollback without a silent Mock fallback.
- `server/src/modelControl/modelRuntimeResolver.test.js` proves that production Chat requires a database-approved
  Route, Deployment, current SecretRef, deployed promotion, current evaluation and legal evidence, active operational
  policy, remaining budget, current health, a closed circuit, and available rate and concurrency capacity.
- `server/src/chat/chatService.test.js` proves that production capacity is acquired before Provider classification or
  streaming and released after completion, stop, failure, or dispatch preparation failure.
- `/api/admin/model-control/chat-production-readiness` exposes the same checks to authorized administrators without
  returning secret material or the underlying SecretRef address.
- `e2e/chat-streaming.spec.ts` verifies a named live message log and composer, Enter-to-send, keyboard focus movement,
  and no horizontal overflow or out-of-viewport Chat panels at 390x844.

Run the focused gate with:

```sh
npm run test:chat-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the full Playwright suite remains part of `check:pr`.

## Production decision

Production remains `no_go`. `openai_production` can only be constructed from an internal database approval proof and
cannot be enabled by environment variables alone. Every real dispatch additionally acquires database-backed rate and
concurrency capacity after budget, health, circuit, and kill-switch checks. A production go decision still requires a
scoped and unexpired approval reference, an independent production SecretRef, final call and amount limits, named
rotation/emergency-disable/rollback owners, and a time-bounded UAT. Staging engineering evidence must not be treated
as production approval.
