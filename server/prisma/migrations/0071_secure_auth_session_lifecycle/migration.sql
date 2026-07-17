CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "client_label" TEXT NOT NULL DEFAULT 'Unknown client',
  "network_hash" TEXT,
  "risk_status" TEXT NOT NULL DEFAULT 'normal',
  "risk_reason_code" TEXT,
  "risk_detected_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason_code" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_risk_status_check" CHECK ("risk_status" IN ('normal', 'suspicious', 'compromised')),
  CONSTRAINT "auth_sessions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "auth_sessions_client_label_check" CHECK (char_length("client_label") BETWEEN 1 AND 80),
  CONSTRAINT "auth_sessions_network_hash_check" CHECK ("network_hash" IS NULL OR "network_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_sessions_risk_evidence_check" CHECK (
    ("risk_status" = 'normal' AND "risk_reason_code" IS NULL AND "risk_detected_at" IS NULL)
    OR ("risk_status" IN ('suspicious', 'compromised') AND "risk_reason_code" IS NOT NULL AND "risk_detected_at" IS NOT NULL)
  ),
  CONSTRAINT "auth_sessions_revocation_evidence_check" CHECK (
    ("revoked_at" IS NULL AND "revoke_reason_code" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoke_reason_code" IS NOT NULL)
  )
);

INSERT INTO "auth_sessions" (
  "id", "user_id", "client_label", "risk_status", "risk_reason_code", "risk_detected_at",
  "revoked_at", "revoke_reason_code", "created_at", "last_seen_at", "expires_at", "updated_at"
)
SELECT
  "family_id",
  "user_id",
  'Unknown client',
  CASE WHEN bool_or("reuse_detected_at" IS NOT NULL) THEN 'compromised' ELSE 'normal' END,
  CASE WHEN bool_or("reuse_detected_at" IS NOT NULL) THEN 'refresh_token_reuse' ELSE NULL END,
  MAX("reuse_detected_at"),
  CASE
    WHEN bool_or("reuse_detected_at" IS NOT NULL) THEN COALESCE(MAX("reuse_detected_at"), MAX("revoked_at"), MAX("updated_at"))
    WHEN bool_or("revoked_at" IS NULL AND "expires_at" > CURRENT_TIMESTAMP) THEN NULL
    ELSE COALESCE(MAX("revoked_at"), MAX("expires_at"))
  END,
  CASE
    WHEN bool_or("revoked_at" IS NULL AND "expires_at" > CURRENT_TIMESTAMP) THEN NULL
    WHEN bool_or("reuse_detected_at" IS NOT NULL) THEN 'refresh_token_reuse'
    ELSE 'legacy_session_inactive'
  END,
  MIN("created_at"),
  MAX("updated_at"),
  MAX("expires_at"),
  MAX("updated_at")
FROM "refresh_tokens"
GROUP BY "family_id", "user_id";

CREATE INDEX "auth_sessions_user_id_last_seen_at_idx" ON "auth_sessions"("user_id", "last_seen_at");
CREATE INDEX "auth_sessions_risk_status_revoked_at_last_seen_at_idx" ON "auth_sessions"("risk_status", "revoked_at", "last_seen_at");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
