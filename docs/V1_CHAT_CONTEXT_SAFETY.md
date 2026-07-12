# V1 Chat Context And Runtime Safety

V1-22 extends the Mock-only Chat data plane with governed attachment metadata, explicit product context, and an
application-owned safety boundary. It does not enable a real classifier, attachment-byte reader, or Chat Provider.

## Attachment And Context Boundary

- A turn accepts at most five unique attachment ids and five unique product-context references.
- Attachments must belong directly to the current user, be uploaded and scan-clean, use an allowed purpose and MIME,
  remain at or below 20 MiB each, and remain at or below 40 MiB combined.
- Generic Admin access does not grant Chat access to another user's attachment or private Library item.
- Product context supports Task and Library references. The server resolves their current authorized content at read
  time; clients cannot submit context bodies or permission claims.
- PostgreSQL stores only attachment ids and `{type, id}` product-context references. Resolved context bodies remain in
  request memory and are never copied into Chat safety evidence, audit metadata, or review metadata.
- Attachment object bytes are not read or transmitted in V1-22. That boundary remains V1-24.

## Safety Boundary

- The input message, selected product context, and attachment descriptors are classified before quota, credit, or
  generation dispatch. Unknown or unavailable classification blocks.
- Output is held in an application buffer. No more than 512 unclassified characters may accumulate, and no content is
  encrypted, persisted, or emitted over SSE before an application classification allows it.
- A later blocked or review-required segment preserves only previously classified output. The pending segment is
  discarded and the turn closes as blocked with a stable reason code.
- The default classifier is a deterministic Mock fixture. Production classifiers and Provider-native safety remain
  absent and require later approval.

## Evidence And Review

Each Chat turn may store input and output evidence containing a stable identity-free safety id, policy version, stage,
disposition, bounded reason codes, classifier source, character count, and timestamp. It never stores the classified
text, direct user identity, private URL, Provider payload, or attachment bytes.

Review-required results create an `AdminReview` in the `chat_safety` queue. Review metadata contains only the Chat turn
and conversation ids, safety id, policy version, stage, reason codes, attachment count, and context types. Existing
support category `moderation_appeal` can reference the resulting moderation decision without copying Chat content.
