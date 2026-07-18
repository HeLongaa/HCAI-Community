# Trust Safety Operations

TRUST-02 adds versioned content-safety rules, idempotent hash-only signals, an event-derived moderation queue, priority-based SLA evidence, and constrained bulk queue operations for personal accounts.

## Rule Lifecycle

Each `SafetyRuleVersion` is immutable and starts as `draft`. `SafetyRuleTransition` facts move a version through `canary`, `active`, and `retired`. Activating a version retires the currently active sibling for the same rule key. Activating an older retired version is an audited rollback. Canary rollout is bounded to 1-99%; active is 100%; retired is 0%.

## Signals And Queue

`SafetySignal.sourceKey` is globally idempotent. Signals store stable identifiers, scores, severity, timestamps, rule references, and SHA-256 evidence only. Raw content and Provider payloads remain outside this model. The first signal for a case appends an `enqueue` event.

`ModerationQueueEvent` is append-only. Assignment, release, priority changes, escalation, assignee, and due time are derived from the event sequence. SLA targets are 48 hours for normal, 12 hours for high, and 1 hour for critical priority. The immutable report, evidence, decision, and appeal chain remains unchanged.

## Bulk Boundary

Bulk operations are limited to assignment, release, and priority changes. Every execution requires a preview-derived target hash, exact confirmation text, a stable reason code, and an idempotency key. Missing targets are skipped and reported. Moderation decisions and appeal decisions have no bulk endpoint and remain independent per-case actions.

## Operations

Use the Trust & Safety Admin page to inspect rule versions, canary or activate versions, roll back retired versions, filter the queue by assignment/SLA/priority, assign individual cases, and run confirmed bulk queue changes. Metrics expose active/canary rules, recent signals, assignment counts, and SLA breaches without raw sensitive content.
