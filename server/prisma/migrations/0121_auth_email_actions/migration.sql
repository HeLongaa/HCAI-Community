ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

UPDATE "users"
SET "email_verified_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP)
WHERE "email" IS NOT NULL;

CREATE TABLE "auth_email_actions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "encryption_key_id" TEXT NOT NULL,
  "encryption_iv" TEXT NOT NULL,
  "encryption_tag" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoke_reason_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_email_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_email_actions_token_hash_key" ON "auth_email_actions"("token_hash");
CREATE INDEX "auth_email_actions_user_id_kind_created_at_idx" ON "auth_email_actions"("user_id", "kind", "created_at");
CREATE INDEX "auth_email_actions_expires_at_id_idx" ON "auth_email_actions"("expires_at", "id");
CREATE INDEX "auth_email_actions_revoked_at_id_idx" ON "auth_email_actions"("revoked_at", "id");
CREATE INDEX "auth_email_actions_consumed_at_id_idx" ON "auth_email_actions"("consumed_at", "id");

ALTER TABLE "auth_email_actions" ADD CONSTRAINT "auth_email_actions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
