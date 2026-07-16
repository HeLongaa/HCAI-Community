# Unified AI Generation Runtime

`AI-CORE-01` defines one governed execution contract for Image, Chat, Video, and Music. The runtime stays personal-account only and does not enable any real Provider network request.

## User contract

- Create accepts a normalized workspace request and an optional 8-128 character idempotency key. The web client always supplies one.
- Status is read from the durable `CreativeGeneration` projection and never exposes raw Provider payloads, credentials, storage keys, or private output URLs.
- Cancel is owner-scoped, idempotent, audited, and releases unsettled quota and credits when Provider charging is not confirmed.
- Retry always requires user confirmation and creates a linked child attempt. It never mutates the original generation fact.
- Cost, quota, safety, and governed input/output asset references are projected consistently for all four workspaces.

## Dispatch safety

`CreativeGenerationExecution` claims `(actor_id, idempotency_key)` before adapter dispatch. A reused key with a different payload is rejected. A concurrent duplicate receives an in-progress conflict, while a completed duplicate reads the existing durable generation without dispatching again.

Claims have a bounded lease. An expired claim becomes `recovery_required`; the runtime does not automatically redispatch because the previous process may have reached a Provider before failing. An authorized operator must inspect evidence and mark the abandoned execution failed before the user can use the explicit Retry flow.

## Operations

- Admin generation records support cursor pagination, filters, stable sorting, full-dataset summary counts, and JSON/CSV export.
- Admin execution requests expose claimed, succeeded, failed, and recovery-required states.
- Recovery, cancellation, retry authorization, Provider replay, accounting, and asset lifecycle actions remain permission checked and audited.
- PostgreSQL migration `0058_creative_generation_execution` adds the request ledger without rewriting existing generation history.

## Provider boundary

This task adds no endpoint, credential, network client, or traffic eligibility. Provider calls remain disabled until the later evaluation, legal, model deployment, and explicit Provider approval gates are complete.
