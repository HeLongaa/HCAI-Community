CREATE TYPE "ProfileVisibility" AS ENUM ('public', 'unlisted', 'private');

ALTER TABLE "users"
  ADD COLUMN "account_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletion_requested_at" TIMESTAMP(3),
  ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3),
  ADD COLUMN "deletion_reason_code" TEXT;

ALTER TABLE "profiles"
  ADD COLUMN "visibility" "ProfileVisibility" NOT NULL DEFAULT 'public',
  ADD COLUMN "discoverable" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "show_activity" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "show_portfolio" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "profiles_visibility_discoverable_handle_idx"
  ON "profiles"("visibility", "discoverable", "handle");

ALTER TABLE "users"
  ADD CONSTRAINT "users_deletion_schedule_consistency_check"
  CHECK (
    ("deletion_requested_at" IS NULL AND "deletion_scheduled_at" IS NULL AND "deletion_reason_code" IS NULL)
    OR
    ("deletion_requested_at" IS NOT NULL AND "deletion_scheduled_at" > "deletion_requested_at" AND "deletion_reason_code" IS NOT NULL)
  );
