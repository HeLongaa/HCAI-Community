# Provider output safety assurance

This contract records the upstream safety responsibility for internally dispatched creative Provider outputs without
persisting raw Provider payloads. It does not apply to user uploads and does not weaken their quarantine or review
requirements.

## Stored evidence

Each accepted assurance stores only:

- the governed Provider id;
- the exact Provider operation reference;
- the upstream policy reference;
- a SHA-256 hash of a bounded, canonical evidence projection;
- the evidence source and attestation time.

Raw prompts, output URLs, Provider credentials, response bodies, and direct user identity must not be included in the
stored projection. The hashing input is capped at 64 KiB and is discarded after the digest is created.

## Environment boundary

`operator_staging` evidence may be retained for a controlled Staging rehearsal. It never authorizes Production output
release. Production accepts only `provider_response` evidence bound to the same Provider and operation reference.

An adapter must map an observed, documented upstream response field into this contract. A completed lifecycle status by
itself is not assurance. Unknown, missing, malformed, timed-out, or mismatched evidence fails closed.

## Remaining integration work

Provider-specific response mappings cannot be guessed. Before enabling a Provider, capture a sanitized real response,
identify its stable policy and operation fields, add contract fixtures for allow/refuse/unknown/malformed responses, and
bind the resulting assurance to `generation.safety.providerNative`. Production creative traffic remains disabled until
those mappings and legal approval are complete.
