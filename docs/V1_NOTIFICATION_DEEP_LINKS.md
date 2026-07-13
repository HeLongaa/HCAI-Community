# V1 Notification Deep Links and Recovery

V1-38 standardizes application-internal notification navigation without enabling Provider traffic or external notification delivery.

## Contract

Every notification DTO exposes an allowlisted `metadata.target` with `version: 1`, a controlled `surface`, `intent`, and `fallbackSurface`. Optional identifiers are limited to application-owned workspace, generation, task, submission, review, and asset ids. Admin drill-down fields use a separate allowlist.

The serializer removes unknown metadata and target fields from both new and legacy records. Raw prompts, Provider payloads and ids, storage keys, signed URLs, tokens, private error details, and arbitrary external URLs are not notification fields.

## Navigation and authorization

- Generations use `#generations/{generationId}`; assets use `#assets/{assetId}`.
- Workspaces use `#playground?workspace={image|video|music|chat}`.
- Task deliveries use `#mine?taskId=...&submissionId=...`.
- Admin targets encode only allowlisted query fields.
- The URL is the recovery source across refresh, browser navigation, and re-login. React state is not authoritative.
- A deep link never grants access. Each destination reloads through its existing owner-, participant-, or permission-scoped API.
- Missing, archived, malformed, or unauthorized targets fall back to a safe application surface and must not disclose resource existence.

Opening and marking read remain separate operations. A failed navigation does not implicitly remove an unread notification.

## Idempotency and audience

Notification creation continues to use the durable lifecycle source key or unread resource dedupe. Owner events and operations/Admin events retain separate audiences from the V1-13 lifecycle catalog. Non-actionable queued/running updates do not create user notification noise.

## Verification

Tests cover target normalization, metadata redaction, legacy target conversion, recipient ownership, lifecycle dedupe, task delivery targets, generation notification navigation, and refresh recovery. `check:pr` and fixture production smoke remain the release gates.

Real Provider clients, credentials, paid traffic, webhook, Slack, and email lifecycle delivery remain disabled and require separate approval.
