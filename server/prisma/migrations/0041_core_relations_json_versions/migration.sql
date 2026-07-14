-- Version JSON documents independently without changing their compatibility shape.
ALTER TABLE "audit_events" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "security_events" ADD COLUMN "details_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "system_settings" ADD COLUMN "value_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "operation_leases" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "admin_reviews" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "profiles" ADD COLUMN "portfolio_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "stats_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tasks" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "task_proposals" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "task_submissions" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "posts" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "library_items" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "internal_accounting_operations" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "internal_accounting_movements" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "accounting_reconciliation_issues" ADD COLUMN "evidence_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "media_assets" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "media_scan_jobs" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_generations" ADD COLUMN "usage_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "credit_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "quota_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "safety_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "policy_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_provider_operations" ADD COLUMN "safe_metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "chat_turns" ADD COLUMN "usage_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "product_context_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "safety_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_generation_mutations" ADD COLUMN "safe_metadata_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "result_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_provider_replay_ledger" ADD COLUMN "side_effect_plan_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "side_effect_result_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_provider_cost_ledgers" ADD COLUMN "pricing_snapshot_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "usage_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "risk_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "creative_credit_ledger" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "notifications" ADD COLUMN "metadata_schema_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "task_submission_assets" (
  "submission_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_submission_assets_pkey" PRIMARY KEY ("submission_id", "asset_id")
);

CREATE TABLE "creative_generation_assets" (
  "generation_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_generation_assets_pkey" PRIMARY KEY ("generation_id", "direction", "asset_id")
);

CREATE TABLE "chat_turn_input_assets" (
  "turn_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_turn_input_assets_pkey" PRIMARY KEY ("turn_id", "asset_id")
);

CREATE UNIQUE INDEX "task_submission_assets_submission_id_position_key" ON "task_submission_assets"("submission_id", "position");
CREATE INDEX "task_submission_assets_asset_id_idx" ON "task_submission_assets"("asset_id");
CREATE INDEX "task_submission_assets_owner_id_created_at_idx" ON "task_submission_assets"("owner_id", "created_at");
CREATE UNIQUE INDEX "creative_generation_assets_generation_id_direction_position_key" ON "creative_generation_assets"("generation_id", "direction", "position");
CREATE INDEX "creative_generation_assets_asset_id_direction_idx" ON "creative_generation_assets"("asset_id", "direction");
CREATE INDEX "creative_generation_assets_owner_id_created_at_idx" ON "creative_generation_assets"("owner_id", "created_at");
CREATE UNIQUE INDEX "chat_turn_input_assets_turn_id_position_key" ON "chat_turn_input_assets"("turn_id", "position");
CREATE INDEX "chat_turn_input_assets_asset_id_idx" ON "chat_turn_input_assets"("asset_id");
CREATE INDEX "chat_turn_input_assets_owner_id_created_at_idx" ON "chat_turn_input_assets"("owner_id", "created_at");

ALTER TABLE "task_submission_assets" ADD CONSTRAINT "task_submission_assets_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "task_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_submission_assets" ADD CONSTRAINT "task_submission_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_submission_assets" ADD CONSTRAINT "task_submission_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_generation_assets" ADD CONSTRAINT "creative_generation_assets_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_generation_assets" ADD CONSTRAINT "creative_generation_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creative_generation_assets" ADD CONSTRAINT "creative_generation_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_turn_input_assets" ADD CONSTRAINT "chat_turn_input_assets_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "chat_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_turn_input_assets" ADD CONSTRAINT "chat_turn_input_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_turn_input_assets" ADD CONSTRAINT "chat_turn_input_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill only resolvable internal references. Unmatched legacy IDs remain in
-- compatibility arrays and are reported by the DATA-02 reconciliation query.
INSERT INTO "task_submission_assets" ("submission_id", "asset_id", "owner_id", "position")
SELECT submission."id", asset_id, submission."submitter_id", ordinality - 1
FROM "task_submissions" submission
CROSS JOIN LATERAL UNNEST(submission."asset_ids") WITH ORDINALITY AS refs(asset_id, ordinality)
JOIN "media_assets" asset ON asset."id" = asset_id
ON CONFLICT DO NOTHING;

INSERT INTO "creative_generation_assets" ("generation_id", "asset_id", "owner_id", "direction", "position")
SELECT generation."id", asset_id, generation."actor_id", 'input', ordinality - 1
FROM "creative_generations" generation
CROSS JOIN LATERAL UNNEST(generation."input_asset_ids") WITH ORDINALITY AS refs(asset_id, ordinality)
JOIN "media_assets" asset ON asset."id" = asset_id
WHERE generation."actor_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "creative_generation_assets" ("generation_id", "asset_id", "owner_id", "direction", "position")
SELECT generation."id", asset_id, generation."actor_id", 'output', ordinality - 1
FROM "creative_generations" generation
CROSS JOIN LATERAL UNNEST(generation."output_asset_ids") WITH ORDINALITY AS refs(asset_id, ordinality)
JOIN "media_assets" asset ON asset."id" = asset_id
WHERE generation."actor_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "chat_turn_input_assets" ("turn_id", "asset_id", "owner_id", "position")
SELECT turn."id", asset_id, conversation."owner_id", ordinality - 1
FROM "chat_turns" turn
JOIN "chat_conversations" conversation ON conversation."id" = turn."conversation_id"
CROSS JOIN LATERAL UNNEST(turn."input_asset_ids") WITH ORDINALITY AS refs(asset_id, ordinality)
JOIN "media_assets" asset ON asset."id" = asset_id
ON CONFLICT DO NOTHING;
