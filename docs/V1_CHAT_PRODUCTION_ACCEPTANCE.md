# AI-CHAT-02 Production UX Acceptance

AI-CHAT-02 closes the engineering acceptance surface for Chat quality, long conversations, bounded fixture load,
mobile layout, keyboard accessibility, and runtime rollback. It does not approve a real Provider for production.

## Automated evidence

- `config/chat-production-ux-acceptance.json` is the machine-readable acceptance contract and keeps the production
  decision at `no_go`.
- `server/src/chat/chatProductionAcceptance.test.js` proves that a 100-message conversation rejects the next turn
  before any Provider or classifier dispatch, runs 20 isolated conversations concurrently with completed generation
  accounting, and proves `openai_staging -> disabled` rollback without a silent Mock fallback.
- `e2e/chat-streaming.spec.ts` verifies a named live message log and composer, Enter-to-send, keyboard focus movement,
  and no horizontal overflow or out-of-viewport Chat panels at 390x844.

Run the focused gate with:

```sh
npm run test:chat-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the full Playwright suite remains part of `check:pr`.

## Production decision

Production remains fail-closed with `CHAT_PROVIDER_MODE=disabled`. A production go decision requires AI-CHAT-01 real
Provider acceptance evidence, a scoped and unexpired approval reference, approved data and safety terms, monitored
budget controls, and an operator-owned rollback rehearsal. Staging engineering evidence must not be treated as
production approval.
