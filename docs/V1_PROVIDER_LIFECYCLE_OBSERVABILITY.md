# V1 Provider Lifecycle Observability

## Scope

V1-13 closes the internal Provider lifecycle observability loop for fixture and durable application events. It does not register or enable Provider HTTP, callback, polling, probe, fallback, dispatch, mutation, output-fetch, or external notification clients.

Real Provider traffic and outbound webhook, Slack, or email delivery remain separately approval-gated. RMB payment, withdrawal, KYC, invoicing, merchant settlement, and payment refunds are outside this task.

## Event Contract

`server/src/creative/providerLifecycleEventCatalog.js` is the machine-readable source for lifecycle event family, severity, audience, notification policy, audit policy, dedupe discriminator, metric dimensions, and operator handoff hint.

Audience rules:

| Fact | Audience | Internal notification |
| --- | --- | --- |
| queued / running | audit only | No |
| completed / cancelled | generation owner | Yes |
| failed / review required | owner and operations | Yes |
| polling timeout / retry exhaustion / output ingestion failure | operations | Yes |
| callback accepted / replay progress / retry scheduled or cleared | audit only | No |
| cost reconciliation / budget or control block | operations | Existing internal budget/control notification path |

All notifications are in-app `Notification` records. The lifecycle projection never sends an external message.

## Idempotency And Recovery

- Generation side-effect notification and audit operations retain stable replay operation keys.
- Notification recipients are derived from catalog audience, not from the presence of an audit permission alone.
- Source-key dedupe is per recipient, event type, resource, and durable fact key.
- Re-recording an existing polling timeout can repair a missing notification without duplicating the audit event.
- Retry exhaustion uses durable retry state id, status, and version.
- Output ingestion failure uses ingestion id, status, and bounded error code.
- Partial Provider replay recovery continues from completed operation keys.

## Safe Evidence

Admin audit list, export, and detail share `serializeAuditEvent`. Provider retry rows use an explicit metadata allowlist. Raw Provider body/header/log text, prompt text, URLs, tokens, source keys, failure hashes, policy hashes, output digests, and arbitrary metadata are not returned by the retry projection.

Lifecycle metric labels are limited to event, family, status, source type, provider, workspace, severity, and error category. Generation ids, Provider job ids, source keys, failure hashes, policy hashes, media ids, prompts, and URLs are never labels.

## Operations Views

Admin operations metrics expose `creativeProviderLifecycle` with:

- total lifecycle facts;
- breakdowns by event, family, status, source type, provider, workspace, severity, and category;
- safe drill-down samples for retry exhaustion, polling timeout, output ingestion failure, and cost reconciliation;
- remediation hints that link back to the matching audit filter.

The Prometheus endpoint exposes the same bounded dimensions under `newchat_creative_provider_lifecycle_*`.

## Fixture Verification

1. Keep Provider runtime mode disabled or use injected fixture clients only.
2. Exercise completed, failed, cancelled, review-required, timeout, retry-exhausted, and ingestion-failed fixtures.
3. Confirm queued/running facts create audit records without inbox notifications.
4. Confirm completed/cancelled notify only the owner.
5. Confirm failed/review-required notify owner and operations.
6. Confirm timeout/retry-exhausted/ingestion-failed notify operations once per durable fact.
7. Compare Admin audit list, export, and detail for identical safe retry evidence.
8. Inspect Admin operations metrics and `/metrics` for bounded labels only.

## Incident Handoff

- Retry exhausted: inspect operation type and error category before any manual replay.
- Polling timed out: inspect polling audit and durable retry state; keep status clients disabled unless separately approved.
- Output ingestion failed: inspect bounded ingestion error and storage/media-scan readiness; do not expose or reuse raw Provider URLs.
- Cost reconciliation required: compare normalized estimate/actual evidence before closeout.

Never enable real Provider or external notification clients as an incident workaround.
