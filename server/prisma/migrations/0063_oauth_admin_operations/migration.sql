ALTER TABLE "auth_accounts"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "oauth_authorization_requests"
  ADD COLUMN "revoked_at" TIMESTAMP(3),
  ADD COLUMN "revoke_reason_code" TEXT;

DROP INDEX "oauth_authorization_requests_expires_at_consumed_at_idx";
CREATE INDEX "oauth_authorization_requests_expires_at_consumed_at_revoked_at_idx"
  ON "oauth_authorization_requests"("expires_at", "consumed_at", "revoked_at");

CREATE TABLE "oauth_provider_controls" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "enabled_at" TIMESTAMP(3),
  "disabled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauth_provider_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_provider_controls_provider_check" CHECK ("provider" IN ('google', 'apple', 'discord')),
  CONSTRAINT "oauth_provider_controls_version_check" CHECK ("version" > 0),
  CONSTRAINT "oauth_provider_controls_reason_code_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "oauth_provider_controls_timestamps_check" CHECK (
    ("enabled" = true AND "enabled_at" IS NOT NULL AND "disabled_at" IS NULL)
    OR ("enabled" = false AND "disabled_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "oauth_provider_controls_provider_key" ON "oauth_provider_controls"("provider");

ALTER TABLE "oauth_authorization_requests"
  ADD CONSTRAINT "oauth_authorization_requests_revoke_reason_check" CHECK (
    ("revoked_at" IS NULL AND "revoke_reason_code" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoke_reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$')
  );
