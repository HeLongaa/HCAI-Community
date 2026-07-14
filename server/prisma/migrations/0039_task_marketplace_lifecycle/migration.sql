-- Older deployments did not enforce one proposal per creator and task at the
-- database boundary. Reconcile any historical duplicates before adding the
-- unique index so this migration is deployable without discarding the
-- accepted proposal or leaving evidence pointed at a deleted row.
CREATE TEMP TABLE "_task_proposal_duplicate_map" AS
WITH ranked AS (
  SELECT
    "id" AS "proposal_id",
    "task_id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "task_id", "proposer_id"
      ORDER BY
        CASE "status"
          WHEN 'accepted' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'rejected' THEN 2
          WHEN 'withdrawn' THEN 3
        END,
        "created_at" ASC,
        "id" ASC
    ) AS "canonical_id",
    ROW_NUMBER() OVER (
      PARTITION BY "task_id", "proposer_id"
      ORDER BY
        CASE "status"
          WHEN 'accepted' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'rejected' THEN 2
          WHEN 'withdrawn' THEN 3
        END,
        "created_at" ASC,
        "id" ASC
    ) AS "proposal_rank"
  FROM "task_proposals"
)
SELECT
  "proposal_id" AS "duplicate_id",
  "canonical_id",
  "task_id"
FROM ranked
WHERE "proposal_rank" > 1;

-- Keep an explicit reconciliation trail on the surviving proposal.
WITH reconciled AS (
  SELECT
    "canonical_id",
    JSONB_AGG("duplicate_id" ORDER BY "duplicate_id") AS "duplicate_ids"
  FROM "_task_proposal_duplicate_map"
  GROUP BY "canonical_id"
)
UPDATE "task_proposals" AS proposal
SET "metadata" = COALESCE(proposal."metadata", '{}'::JSONB)
  || JSONB_BUILD_OBJECT('migrationDeduplicatedProposalIds', reconciled."duplicate_ids")
FROM reconciled
WHERE proposal."id" = reconciled."canonical_id";

-- Audit events can reference a proposal directly as well as through metadata.
UPDATE "audit_events" AS event
SET "resource_id" = duplicate."canonical_id"
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE event."resource_type" = 'task_proposal'
  AND event."resource_id" = duplicate."duplicate_id";

UPDATE "audit_events" AS event
SET "metadata" = JSONB_SET(event."metadata", '{proposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE event."metadata" ->> 'proposalId' = duplicate."duplicate_id";

UPDATE "audit_events" AS event
SET "metadata" = JSONB_SET(event."metadata", '{selectedProposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE event."metadata" ->> 'selectedProposalId' = duplicate."duplicate_id";

-- Notifications and Admin review records use task resource IDs, but may carry
-- proposal IDs in their safe metadata projections.
UPDATE "notifications" AS notification
SET "metadata" = JSONB_SET(notification."metadata", '{proposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE notification."metadata" ->> 'proposalId' = duplicate."duplicate_id";

UPDATE "notifications" AS notification
SET "metadata" = JSONB_SET(notification."metadata", '{selectedProposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE notification."metadata" ->> 'selectedProposalId' = duplicate."duplicate_id";

UPDATE "admin_reviews" AS review
SET "metadata" = JSONB_SET(review."metadata", '{proposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE review."metadata" ->> 'proposalId' = duplicate."duplicate_id";

UPDATE "admin_reviews" AS review
SET "metadata" = JSONB_SET(review."metadata", '{selectedProposalId}', TO_JSONB(duplicate."canonical_id"), false)
FROM "_task_proposal_duplicate_map" AS duplicate
WHERE review."metadata" ->> 'selectedProposalId' = duplicate."duplicate_id";

DELETE FROM "task_proposals" AS proposal
USING "_task_proposal_duplicate_map" AS duplicate
WHERE proposal."id" = duplicate."duplicate_id";

-- Task list projections cache the proposal count in metadata.
WITH affected_tasks AS (
  SELECT DISTINCT "task_id"
  FROM "_task_proposal_duplicate_map"
), proposal_counts AS (
  SELECT
    affected."task_id",
    COUNT(proposal."id")::INTEGER AS "proposal_count"
  FROM affected_tasks AS affected
  LEFT JOIN "task_proposals" AS proposal ON proposal."task_id" = affected."task_id"
  GROUP BY affected."task_id"
)
UPDATE "tasks" AS task
SET "metadata" = JSONB_SET(
  COALESCE(task."metadata", '{}'::JSONB),
  '{proposals}',
  TO_JSONB(proposal_counts."proposal_count"),
  true
)
FROM proposal_counts
WHERE task."id" = proposal_counts."task_id";

CREATE UNIQUE INDEX "task_proposals_task_id_proposer_id_key"
ON "task_proposals"("task_id", "proposer_id");

DROP TABLE "_task_proposal_duplicate_map";
