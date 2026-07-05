ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_token_hash" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "reuse_detected_at" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "refresh_tokens" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
