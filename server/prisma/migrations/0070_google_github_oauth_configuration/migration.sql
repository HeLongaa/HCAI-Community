ALTER TABLE "oauth_authorization_requests"
  ADD COLUMN "provider_control_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "oauth_authorization_requests"
  ADD CONSTRAINT "oauth_authorization_requests_provider_control_version_check"
  CHECK ("provider_control_version" >= 0);

ALTER TABLE "oauth_provider_controls"
  ADD COLUMN "client_id" TEXT,
  ADD COLUMN "redirect_uri" TEXT,
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "client_secret_ref" TEXT,
  ADD COLUMN "configuration_updated_at" TIMESTAMP(3);

ALTER TABLE "oauth_provider_controls" DROP CONSTRAINT "oauth_provider_controls_provider_check";
ALTER TABLE "oauth_provider_controls"
  ADD CONSTRAINT "oauth_provider_controls_provider_check"
  CHECK ("provider" IN ('google', 'github', 'apple', 'discord'));

ALTER TABLE "oauth_provider_controls"
  ADD CONSTRAINT "oauth_provider_controls_configuration_check"
  CHECK (
    ("client_id" IS NULL AND "redirect_uri" IS NULL AND cardinality("scopes") = 0 AND "client_secret_ref" IS NULL AND "configuration_updated_at" IS NULL)
    OR (
      "client_id" IS NOT NULL AND char_length("client_id") BETWEEN 1 AND 255
      AND "redirect_uri" IS NOT NULL AND char_length("redirect_uri") BETWEEN 1 AND 2048
      AND cardinality("scopes") BETWEEN 1 AND 10
      AND "client_secret_ref" ~ '^secret://[A-Za-z0-9._~:/-]{1,240}$'
      AND "configuration_updated_at" IS NOT NULL
    )
  );
