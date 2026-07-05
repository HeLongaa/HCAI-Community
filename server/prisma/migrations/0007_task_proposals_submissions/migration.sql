CREATE TYPE "TaskProposalStatus" AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

CREATE TYPE "TaskSubmissionStatus" AS ENUM ('pending_review', 'approved', 'rejected');

CREATE TABLE "task_proposals" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "proposer_id" TEXT NOT NULL,
  "cover_letter" TEXT NOT NULL,
  "estimate" TEXT,
  "status" "TaskProposalStatus" NOT NULL DEFAULT 'pending',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_submissions" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "submitter_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "asset_ids" TEXT[],
  "rights_note" TEXT NOT NULL DEFAULT '',
  "status" "TaskSubmissionStatus" NOT NULL DEFAULT 'pending_review',
  "review_note" TEXT,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_proposals_task_id_created_at_idx" ON "task_proposals"("task_id", "created_at");
CREATE INDEX "task_proposals_proposer_id_idx" ON "task_proposals"("proposer_id");
CREATE INDEX "task_submissions_task_id_created_at_idx" ON "task_submissions"("task_id", "created_at");
CREATE INDEX "task_submissions_submitter_id_idx" ON "task_submissions"("submitter_id");
CREATE INDEX "task_submissions_reviewed_by_id_idx" ON "task_submissions"("reviewed_by_id");

ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
