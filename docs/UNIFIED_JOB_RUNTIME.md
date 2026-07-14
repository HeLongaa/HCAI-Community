# Unified Job Runtime

`JOB-01` defines `JobDefinition`, `JobRun`, and `JobAttempt` while reusing the existing cross-instance `OperationLease`. Definitions identify registered handlers and timeouts. Runs contain idempotency/correlation, owner/requester, safe versioned input/result, schedule, cancellation, heartbeat, timeout, and terminal evidence. Attempts bind a single worker to a unique lease token.

The state machine is `queued → running → succeeded|failed|timed_out|cancelled`, with queued cancellation also allowed. Claims and terminal writes use compare-and-set. Late or foreign lease tokens cannot heartbeat or close a run. Existing interval workers automatically create and close JobRuns when a job manager is configured.

Admin APIs provide permission-protected definition/run list, filtering, cursor pagination, detail, and cancellation. Arbitrary handler execution is not exposed. Automatic retry policy, DLQ, Cron scheduling, pause/resume, and manual rerun remain explicitly deferred to `JOB-02`.
