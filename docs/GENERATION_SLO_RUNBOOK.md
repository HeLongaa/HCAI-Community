# Generation SLO Runbook

## Scope

This runbook covers generation success, first persisted result latency, retry rate, and abandonment rate. Metrics are computed from `CreativeGeneration`, the earliest completed output ingestion/asset relation, and successful user cancel mutations. Provider or system cancellation is not counted as user abandonment. Metrics contain no prompt, actor, asset URL, Provider payload, or user-level dimension.

## Triage

1. Confirm the 5-minute and 60-minute burn rates and sample counts. No-sample windows are unknown and never fire.
2. Split the existing generation business metrics by workspace, Provider, terminal status, error category, quota, credit, and cost reconciliation state.
3. Check Provider controls, balance/cap evidence, circuit state, retry backlog, output ingestion, media scanning, and safety review backlog.
4. Disable the affected Provider route or deployment when failures can spend credits or release unchecked output. Do not enable Mock fallback in production.
5. Verify credit/quota compensation and Provider cost reconciliation before recovery.

## Recovery

1. Run one approved synthetic or paid canary through preflight, Provider, output safety, scan, ingestion, and accounting.
2. Re-evaluate SLOs and require both windows to recover before resolving the alert.
3. Record the release or rollback reference, affected workspace and bounded error codes in the incident review.
4. Escalate unresolved critical generation-success alerts after 15 minutes and other generation alerts after 30 minutes.
