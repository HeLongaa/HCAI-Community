-- CreateEnum
CREATE TYPE "AdminReviewDecision" AS ENUM ('approve', 'reject');

-- CreateTable
CREATE TABLE "admin_reviews" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "decision" "AdminReviewDecision",
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_reviews_queue_idx" ON "admin_reviews"("queue");

-- CreateIndex
CREATE INDEX "admin_reviews_status_idx" ON "admin_reviews"("status");

-- AddForeignKey
ALTER TABLE "admin_reviews" ADD CONSTRAINT "admin_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
