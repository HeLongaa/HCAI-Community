# V1 Provider Output Ingestion

Task: V1-09

## Scope

V1-09 converts transient Provider output references into platform-owned, scan-gated media assets. It does not register a real Provider output fetch client, enable paid Provider traffic, or add real-money payment or withdrawal behavior.

## Durable Contract

`CreativeOutputIngestion` stores one record per stable source key. The source key hashes the generation, Provider job, output digest, and output index. Records contain only safe identifiers, status, media/storage ids, detected MIME, byte count, SHA-256, lease timestamps, and stable error codes.

Raw Provider URLs, query signatures, response headers, response bodies, tokens, and full Provider errors have no schema field and are excluded from DTOs, audit metadata, Admin summaries, notifications, and replay records.

## Fetch Boundary

`createProviderOutputFetcher` requires an injected `fetchImpl`; it never falls back to global `fetch`. Before reading bytes it enforces:

- HTTPS, no URL credentials, default TLS port, and an explicit host allowlist
- DNS resolution with rejection of loopback, private, link-local, metadata, reserved, and other non-public addresses
- manual redirect handling with redirects disabled by default and full revalidation when enabled
- request timeout, `Content-Length` preflight, and a streaming hard byte cap
- workspace MIME policy, magic-byte detection through `file-type`, response/declared MIME agreement, extension agreement, and platform-computed SHA-256

Image supports PNG, JPEG, and WebP. Video supports fixture MP4/WebM ingestion. Music supports fixture MP3/WAV/M4A
policy and V1-32 ingests ElevenLabs fixture MP3 bytes from process-local memory only. No real modality Provider output
fetch client is registered by this task. Chat text does not use binary output ingestion.

## Persistence And Recovery

The ingestion ledger uses a claim lease. A stable source key derives a deterministic media asset id and storage key. Recovery first reuses an existing asset, so a replay cannot create a second asset or repeat the scanner step. Provider replay continues only after persistence returns the platform media asset id.

If fetching or persistence fails, generation completion and credit settlement do not run. A repeated callback or polling result can reclaim a failed/expired record and resume. Once persistence succeeds, later replay operations use the recorded output asset ids and execute only missing settlement, quota, completion, notification, or audit steps.

## Media Governance

Every ingested object enters the existing media scanner. Download remains available only through the platform media endpoint and existing clean-asset policy. Provider URLs are never returned to users or Admin operators.

## Runtime Boundary

Creative routes, callback handling, and polling workers accept an injected output fetcher for tests and separately approved staging composition. Production defaults pass no fetcher. A completed Provider result therefore fails closed before asset creation, credit settlement, quota commit, or generation completion unless the caller explicitly supplies the approved boundary.

## Verification

Tests cover disabled defaults, URL and DNS rejection, redirects, timeout-safe errors, content-length and chunked limits, magic-byte MIME and extension mismatch, SHA-256, durable claims, concurrent suppression, expired-lease recovery, deterministic asset reuse, scanner integration, callback/polling replay, partial settlement recovery, safe Admin summaries, and raw-URL exclusion.

`file-type@21.3.4` and `ipaddr.js@2.2.0` introduce no known audit finding as of 2026-07-11. `npm audit --omit=dev` still reports three moderate entries in the existing Prisma 7.8 toolchain through `@prisma/dev` and `@hono/node-server`. The suggested automated fix is a breaking Prisma downgrade to 6.19.3, so it is not applied; this service does not use Hono `serveStatic`, and the toolchain finding remains tracked for an upstream-compatible Prisma update.
