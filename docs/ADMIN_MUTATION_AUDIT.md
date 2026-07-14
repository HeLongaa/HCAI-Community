# Admin Mutation Audit

Every non-GET `/api/admin/**` route is enumerated in `config/admin-mutation-audit.json`. A route must be classified as automatic, domain-audited, or an explicit exception with a reason. The current registry has no exceptions.

Before a classified mutation handler runs, the router writes a mandatory `*.attempted` audit event. It records actor, stable action, resource type/id, reason code, risk, request ID, route, sanitized parameter hash, and attempted outcome. If the audit repository is unavailable, the handler does not execute.

Existing domain events remain authoritative for success, rejection, before/after values, and lifecycle outcome. The route event is intentionally an attempt fact, so it covers denied and failed requests without duplicating the domain success event.

The sanitizer never records authorization/cookie/token/secret/key/signature values, raw prompts, Provider payloads, URLs, ciphertext, or full request bodies. Request IDs accept only bounded safe identifiers; otherwise the server generates one.
