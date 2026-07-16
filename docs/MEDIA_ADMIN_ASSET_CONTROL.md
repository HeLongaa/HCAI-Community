# Media Admin Asset Control

MEDIA-02 extends the MEDIA-01 lifecycle foundation without enabling external storage or scanner traffic.

## Authorization

- `admin:media:read` gates safe cross-owner list and detail projections.
- `admin:media:manage` gates scan decisions, retry, and single or bulk lifecycle transitions.
- `admin:media:export` gates bounded JSON and CSV exports.
- Existing `admin:queue:*` permissions remain attached to the legacy review queue and scanner operations APIs.

## Safety Boundaries

- Admin projections and exports omit storage keys, signed URLs, raw metadata, and Provider payloads.
- Bulk operations accept 1-50 unique asset IDs and return explicit per-item outcomes.
- Archive and delete transitions withdraw published portfolio records. Restore and recover never republish them.
- JSON and CSV exports are bounded to one filtered page and report truncation in JSON.

## Deferred Infrastructure

Real S3/CDN traffic, scanner network calls, private download infrastructure, quarantine cleanup, and production environment evidence remain owned by MEDIA-03. Scope remains personal accounts only.
