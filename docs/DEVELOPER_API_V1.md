# Developer API v1

## Boundary

DEV-02 introduces an explicit personal-account developer API at `/api/v1`. It does not alias the product's internal `/api` routes and does not add tenants, teams, organizations, memberships or invitations. Service account API keys remain default-off and each route requires an explicit scope.

The initial stable surface is read-only:

- `GET /api/v1` returns the machine-readable API contract.
- `GET /api/v1/principal` returns the authenticated service account identity.
- `GET /api/v1/errors` returns the stable error registry.

All responses include `x-request-id`; API v1 responses also include `x-api-version: v1` and `meta.requestId`. A valid caller `x-request-id` is echoed. Invalid or absent values are replaced with a server-generated identifier.

## Idempotency

Every future `POST`, `PUT`, `PATCH` or `DELETE` API v1 operation must require `Idempotency-Key` before registration. Keys are 8-128 characters using letters, digits, `.`, `_`, `:`, or `-`. A claim is scoped to API key identity, HTTP method and route template, and its fingerprint binds the method, route template and SHA-256 of the canonical request body.

The first unsafe route must land with durable, concurrency-safe persistence before it can be registered. The store must retain a result for at least 24 hours. Repeating a key with the same fingerprint replays the original status, allowlisted headers and body; reusing it with another fingerprint returns `IDEMPOTENCY_CONFLICT`. The current v1 surface is read-only, so no speculative idempotency table or no-op mutation endpoint is created.

## Errors

API v1 errors use `{ data: null, error: { code, message, details? }, meta: { apiVersion, requestId } }`. Codes listed by `GET /api/v1/errors` are stable within v1. Messages and optional details are diagnostic and must not be parsed as identifiers. Unknown server failures collapse to `INTERNAL_ERROR` and never expose stack traces or credentials.

Retry only codes whose registry entry has `retryable: true`. Respect `Retry-After` when present and use bounded exponential backoff. A retry of an unsafe operation must keep its original idempotency key.

## Deprecation

`GET /api/developer/principal` is deprecated in favor of `GET /api/v1/principal`. It continues to behave as before during its migration window and returns:

- `Deprecation: @1784419200`, the RFC 9745 structured date for 2026-07-19 UTC.
- `Sunset: Sun, 31 Jan 2027 00:00:00 GMT`, following RFC 8594.
- `Link` relations for deprecation information and the successor route.

The window is longer than the required 180 days. Admins can read the same schedule from `GET /api/admin/developer/api-contract`. Removing or changing a v1 field requires a new major API version; additive optional fields may ship within v1 after compatibility tests pass.

## Verification

Run `npm run test:developer-api-v1`. The gate validates route registration, request ID behavior, stable errors, idempotency parsing and fingerprints, the minimum deprecation window, RFC response headers, OpenAPI and the personal-account boundary.

Normative references for lifecycle headers are [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html) and [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html). `Idempotency-Key` is an application contract while the IETF HTTPAPI specification remains an Internet-Draft; clients must follow this API's published v1 semantics rather than assuming draft behavior not listed here.
