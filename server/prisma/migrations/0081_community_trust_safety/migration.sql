CREATE TYPE "CommunityModerationState" AS ENUM ('visible', 'hidden');
CREATE TYPE "CommunityModerationActionType" AS ENUM ('retain', 'hide', 'uphold', 'restore');

ALTER TABLE "posts"
  ADD COLUMN "moderation_state" "CommunityModerationState" NOT NULL DEFAULT 'visible',
  ADD COLUMN "moderation_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "moderation_updated_at" TIMESTAMP(3);

ALTER TABLE "comments"
  ADD COLUMN "moderation_state" "CommunityModerationState" NOT NULL DEFAULT 'visible',
  ADD COLUMN "moderation_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "moderation_updated_at" TIMESTAMP(3);

CREATE TABLE "community_moderation_actions" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "target_type" "ModerationTargetType" NOT NULL,
  "target_id" TEXT NOT NULL,
  "action" "CommunityModerationActionType" NOT NULL,
  "from_state" "CommunityModerationState" NOT NULL,
  "to_state" "CommunityModerationState" NOT NULL,
  "reason_code" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_moderation_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_moderation_actions_target_check" CHECK ("target_type" IN ('post', 'comment')),
  CONSTRAINT "community_moderation_actions_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$')
);

CREATE UNIQUE INDEX "community_moderation_actions_decision_id_key" ON "community_moderation_actions"("decision_id");
CREATE INDEX "community_moderation_actions_case_id_created_at_id_idx" ON "community_moderation_actions"("case_id", "created_at", "id");
CREATE INDEX "community_moderation_actions_target_type_target_id_created_at_id_idx" ON "community_moderation_actions"("target_type", "target_id", "created_at", "id");
DROP INDEX "posts_status_created_at_id_idx";
CREATE INDEX "posts_status_moderation_state_created_at_id_idx" ON "posts"("status", "moderation_state", "created_at", "id");

ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER community_moderation_actions_immutable BEFORE UPDATE OR DELETE ON "community_moderation_actions" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();

ALTER TABLE "posts" ADD CONSTRAINT "posts_moderation_version_check" CHECK ("moderation_version" >= 0);
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderation_version_check" CHECK ("moderation_version" >= 0);
