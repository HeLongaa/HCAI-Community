# V1-23 Chat Production UI

## Outcome

V1-23 replaces the visible local Chat reply simulation with the typed Chat API. The UI now creates and deletes durable
conversations, recovers paginated history, renders classified SSE deltas, stops active turns, and reports terminal states.

## Product Inputs

- Up to five owner-authorized attachment metadata references can be selected from `/api/chat/input-assets`.
- Up to five explicit Task or Library references can be selected from the current API-backed product state.
- The server re-authorizes every selected reference when the turn is sent.
- Library item ids are retained in the frontend domain model so references stay stable.

## Safety And Recovery

- Blocked, failed, stopped, and interrupted turns remain visible with stable status copy.
- A `moderationDecisionId` opens the Support center with a prefilled moderation appeal.
- Component teardown aborts the browser stream; persisted server state is recovered when the conversation is reopened.
- No local fallback reply is emitted when the API or stream fails.

## Deliberate Limits

- The backend stream remains the deterministic Mock adapter and is visibly labeled as such.
- Attachment bytes, production classifiers, tools, real Provider clients, paid traffic, and failover remain disabled.
- Those production Provider boundaries remain owned by V1-24 and require separate staging approval.

## Verification

- `npm run check:quick`
- `npm run check:pr`
- `npm run smoke:production`
- Browser E2E covers create, SSE, context and attachment selection, stop, refresh recovery, deletion, responsive layout,
  and the safety appeal handoff.
