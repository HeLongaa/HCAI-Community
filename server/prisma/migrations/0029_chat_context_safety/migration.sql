ALTER TABLE "chat_turns"
ADD COLUMN "input_asset_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "product_context" JSONB,
ADD COLUMN "safety" JSONB;
