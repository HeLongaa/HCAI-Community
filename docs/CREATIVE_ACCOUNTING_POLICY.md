# Creative Accounting Policy V1

`CreativeAccountingPolicyV1` is the immutable accounting manifest used by Image, Video, Music, and Chat generation. Its active version is `creative-policy-v1`, effective 2026-07-14.

## Unit boundaries

- Creative credits are internal product consumption units.
- Quota units are counters for actor/workspace daily limits.
- Provider cost uses the external Provider ledger's currency micros.
- None of these units is convertible to another. In particular, credits must never be displayed as USD or another Provider currency.
- A disabled Provider or missing cost ledger is reported as `unavailable`, never as zero.

## Settlement matrix

| Generation fact | Credits | Quota | Provider ledger |
| --- | --- | --- | --- |
| Queued or running | Reserve | Reserve | Independent reservation/lifecycle |
| Persisted completed output | Settle | Commit | Settle or reconcile from Provider evidence |
| Persisted governed output requiring review | Settle | Commit | Settle or reconcile from Provider evidence |
| Failed/cancelled with no output and no billing | Refund | Release | Release |
| Provider cost unknown | Close from generation fact | Close from generation fact | Reconcile only the Provider ledger |

Retries are independent attempts. Each attempt reserves its own credits and quota and stores the policy snapshot active when that attempt began. Existing ledger rows are immutable and are never repriced; records without a policy version are displayed as `legacy`.

## Read APIs

- `GET /api/creative/accounting-policy` returns the active manifest.
- `GET /api/creative/accounting-policy/preview?workspace=&mode=&providerId=` returns actor-scoped credits, quota, capability availability, and Provider cost availability before dispatch.
- `GET /api/admin/creative/accounting-policy/history` returns immutable policy history to callers with `admin:audit:read`.

Policy editing, approval, and rollback are intentionally out of scope for V1-40 and belong to V1-46. This policy does not enable payments, withdrawals, KYC, invoices, merchant settlement, real Provider traffic, credentials, or paid network calls.
