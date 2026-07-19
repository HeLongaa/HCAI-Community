# Account And Generation Risk Controls

`RISK-01` adds account and generation abuse controls for personal accounts. It is separate from content moderation: moderation cases decide whether content is allowed, while risk cases decide whether an account may sign in or dispatch generation work.

The executable contract is `config/account-generation-risk-contract.json`. Run `npm run test:account-generation-risk` for the focused machine checks and route tests, and `npm run test:account-generation-risk:integration` against PostgreSQL for persistence coverage.

## Signals And Dispositions

The closed signal set is `auth_spray`, `account_takeover`, `generation_burst`, `safety_rejection_burst`, and `generation_cost_spike`. Anonymous network spray remains in the existing authentication security monitor and is not assigned to the next user who signs in successfully.

Only an explicit, unexpired disposition blocks a capability:

- `account_restricted` blocks password, demo, OAuth, and refresh-session access.
- `generation_throttled` returns a temporary generation throttle.
- `generation_blocked` denies generation dispatch.
- `monitor` and `cleared` never block.

Expired dispositions stop blocking immediately. The case remains available for operator review and an explicit recovery transition so the evidence trail is not rewritten.

## Enforcement Points

Login evaluation runs only after credentials or Provider identity have resolved to an account. A blocked OAuth session is revoked before credentials are returned. Refresh rotation checks the resulting account, revokes the newly rotated session when an account restriction is active, clears browser refresh credentials, and fails closed.

Generation evaluation runs before request parsing, accounting reservation, or Provider dispatch. Burst, repeated safety rejection, and cost signals can create or update a risk case using deduplicated evidence and explicit dispositions.

## Case Lifecycle

Cases use the state sequence `open`, `restricted`, `appealed`, `recovered`, and `closed`. The transition matrix is validated in the risk domain and repository writes use optimistic versions. Pending appeals must be decided during the operator transition that resolves or reapplies a restriction.

Signals, case-signal links, disposition events, and appeals are append-only. Policy and case updates require expected versions; concurrent changes return stable conflict errors instead of overwriting another operator.

Automatic dispositions are monotonic within an active case: repeated evidence can extend the restriction, `generation_throttled` can escalate to `generation_blocked`, and any generation disposition can escalate to `account_restricted`. New signals never silently downgrade an active restriction, and every evaluation that changes or extends a case appends a system disposition event and increments the case version.

## Privacy Boundary

Risk evidence stores stable reason codes, bounded scores, coarse evidence, hashes, and references. It does not persist credentials, OAuth identities, access or refresh tokens, authorization codes, raw prompts, Provider payloads, full IP addresses, or raw appeal statements.

Appeal statements are normalized and stored only as SHA-256 evidence with a reason code. Admin APIs and exports return the evidence projection and never reconstruct the statement.

## Operations And Recovery

Users can review their own case history and submit one pending appeal per case. Admin operators with `admin:risk:read`, `admin:risk:manage`, or `admin:risk:export` can inspect metrics, change the versioned policy, filter cases, review evidence, decide appeals, recover accounts, and export at most 100 cases per request.

Admin mutations require permissions, reason codes, optimistic versions, and domain audit evidence. Recovery uses a case transition to `recovered` or `closed` with the `cleared` disposition; operators do not delete or directly rewrite signals, events, or appeals.

The migration is `server/prisma/migrations/0090_account_generation_risk_controls/migration.sql`. Deploy it before enabling enforcement in a PostgreSQL environment, then run the integration gate and complete user/Admin browser acceptance on both desktop and mobile layouts.
