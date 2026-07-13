CREATE TYPE "MediaAssetRelationType" AS ENUM ('parent', 'variant', 'reused_as_input');

ALTER TABLE "media_assets" ADD COLUMN "archived_at" TIMESTAMP(3);
DROP INDEX IF EXISTS "media_assets_owner_id_idx";
CREATE INDEX "media_assets_owner_id_archived_at_created_at_idx" ON "media_assets"("owner_id", "archived_at", "created_at");

CREATE TABLE "media_asset_relations" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "source_asset_id" TEXT NOT NULL,
  "target_asset_id" TEXT NOT NULL,
  "relation_type" "MediaAssetRelationType" NOT NULL,
  "source_generation_id" TEXT,
  "target_workspace" TEXT,
  "role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_asset_relations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_asset_relations_source_asset_id_target_asset_id_relation_type_target_workspace_role_key"
  ON "media_asset_relations"("source_asset_id", "target_asset_id", "relation_type", "target_workspace", "role");
CREATE INDEX "media_asset_relations_owner_id_created_at_idx" ON "media_asset_relations"("owner_id", "created_at");
CREATE INDEX "media_asset_relations_source_asset_id_idx" ON "media_asset_relations"("source_asset_id");
CREATE INDEX "media_asset_relations_target_asset_id_idx" ON "media_asset_relations"("target_asset_id");

ALTER TABLE "media_asset_relations" ADD CONSTRAINT "media_asset_relations_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_asset_relations" ADD CONSTRAINT "media_asset_relations_source_asset_id_fkey"
  FOREIGN KEY ("source_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_asset_relations" ADD CONSTRAINT "media_asset_relations_target_asset_id_fkey"
  FOREIGN KEY ("target_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
