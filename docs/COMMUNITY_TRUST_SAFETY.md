# Community Trust And Safety

## Boundary

COMM-02 connects community posts and comments to the independent Trust and Safety case model. Reports, evidence, decisions, appeals, and community moderation actions are immutable facts. `Post.moderationState` and `Comment.moderationState` are query projections, not decision evidence.

Owner lifecycle and moderation lifecycle remain separate. An appeal decision can restore `moderationState` to `visible`, but it never changes a post from owner-deleted or draft back to published.

## Decision Mapping

- Original `no_action` and `warn` decisions retain the current visibility.
- Original `restrict_content`, `remove_content`, and `suspend_account` decisions hide a post or comment.
- Appeal `uphold` keeps the current visibility.
- Appeal `overturn` and `partially_overturn` restore community visibility while preserving the original decision and action facts.
- Every decision for a post or comment creates exactly one immutable `CommunityModerationAction` with from/to state and reason code.

## Transaction

The Prisma path runs the decision, visibility projection CAS, immutable action, domain audit, in-app notification, and delivery creation in one serializable transaction. Any failure rolls back the complete operation. The seed repository mirrors the same behavior for local and E2E validation.

## Notifications

New community reports and appeals notify users with `admin:trust:read`, excluding the actor. Original and appeal decisions notify the reporter and affected author through the preference-aware notification repository. Metadata is allowlisted and contains only case/target identifiers, stable status, reason, outcome, action, and a versioned deep link.

## Operator Sequence

1. Review the target snapshot hash and restricted report statement in Trust Admin.
2. Append one original decision. Community visibility changes atomically when the target is a post or comment.
3. The affected author may submit one appeal within 30 days.
4. A reviewer other than the original reviewer appends the appeal decision.
5. Verify the community action chain, public visibility, notifications, audit record, and queue state.

## Verification

- `npm run test:community-trust-safety`
- `npm run test:community-trust-safety:integration`
- `CI=1 npm run test:e2e -- e2e/community-trust-safety.spec.ts`

Use a fresh PostgreSQL database for migrations `0001` through `0081`. Never bypass the immutable trigger outside an approved test cleanup or retention maintenance transaction.
