CREATE TYPE "PortfolioAssetStatus" AS ENUM ('draft', 'published', 'withdrawn', 'archived');
ALTER TYPE "PostSource" ADD VALUE IF NOT EXISTS 'asset';

CREATE TABLE "profile_portfolio_assets" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "source_generation_id" TEXT,
  "source_submission_id" TEXT,
  "title" TEXT NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "status" "PortfolioAssetStatus" NOT NULL DEFAULT 'draft',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "published_at" TIMESTAMP(3),
  "withdrawn_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profile_portfolio_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profile_portfolio_assets_owner_id_asset_id_key"
  ON "profile_portfolio_assets"("owner_id", "asset_id");
CREATE UNIQUE INDEX "library_items_asset_reference_owner_key"
  ON "library_items"("user_id", "source_id")
  WHERE "source_type" = 'asset' AND "source_id" IS NOT NULL;
CREATE INDEX "profile_portfolio_assets_owner_id_status_sort_order_idx"
  ON "profile_portfolio_assets"("owner_id", "status", "sort_order");
CREATE INDEX "profile_portfolio_assets_asset_id_idx"
  ON "profile_portfolio_assets"("asset_id");
CREATE INDEX "profile_portfolio_assets_source_generation_id_idx"
  ON "profile_portfolio_assets"("source_generation_id");
CREATE INDEX "profile_portfolio_assets_source_submission_id_idx"
  ON "profile_portfolio_assets"("source_submission_id");

ALTER TABLE "profile_portfolio_assets" ADD CONSTRAINT "profile_portfolio_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_portfolio_assets" ADD CONSTRAINT "profile_portfolio_assets_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_portfolio_assets" ADD CONSTRAINT "profile_portfolio_assets_source_generation_id_fkey"
  FOREIGN KEY ("source_generation_id") REFERENCES "creative_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "profile_portfolio_assets" ADD CONSTRAINT "profile_portfolio_assets_source_submission_id_fkey"
  FOREIGN KEY ("source_submission_id") REFERENCES "task_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
