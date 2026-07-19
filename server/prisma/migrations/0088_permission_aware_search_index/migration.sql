CREATE TABLE "search_documents" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lifecycle" TEXT,
    "target" JSONB NOT NULL,
    "target_schema_version" INTEGER NOT NULL DEFAULT 1,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "search_vector" TSVECTOR,
    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "search_document_grants" (
    "document_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    CONSTRAINT "search_document_grants_pkey" PRIMARY KEY ("document_id", "subject_type", "subject_id")
);

CREATE TABLE "search_sync_queue" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "last_error_code" TEXT,
    "source_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "search_sync_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_documents_resource_type_source_id_key" ON "search_documents"("resource_type", "source_id");
CREATE INDEX "search_documents_resource_type_indexed_at_id_idx" ON "search_documents"("resource_type", "indexed_at", "id");
CREATE INDEX "search_documents_is_public_resource_type_indexed_at_idx" ON "search_documents"("is_public", "resource_type", "indexed_at");
CREATE INDEX "search_documents_owner_id_resource_type_indexed_at_idx" ON "search_documents"("owner_id", "resource_type", "indexed_at");
CREATE INDEX "search_documents_search_vector_idx" ON "search_documents" USING GIN ("search_vector");
CREATE INDEX "search_document_grants_subject_type_subject_id_document_id_idx" ON "search_document_grants"("subject_type", "subject_id", "document_id");
CREATE UNIQUE INDEX "search_sync_queue_resource_type_source_id_key" ON "search_sync_queue"("resource_type", "source_id");
CREATE INDEX "search_sync_queue_status_available_at_updated_at_idx" ON "search_sync_queue"("status", "available_at", "updated_at");

ALTER TABLE "search_document_grants"
  ADD CONSTRAINT "search_document_grants_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "search_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION update_search_document_vector() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW."keywords", ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."summary", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "search_documents_vector_updated"
  BEFORE INSERT OR UPDATE OF "title", "summary", "keywords" ON "search_documents"
  FOR EACH ROW EXECUTE FUNCTION update_search_document_vector();

CREATE OR REPLACE FUNCTION enqueue_search_resource() RETURNS trigger AS $$
DECLARE
  source_row jsonb;
  v_source_id text;
  v_source_updated_at timestamp(3);
  queue_id text;
BEGIN
  source_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_source_id := source_row ->> TG_ARGV[1];
  IF v_source_id IS NULL OR v_source_id = '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_source_updated_at := COALESCE((source_row ->> 'updated_at')::timestamp, CURRENT_TIMESTAMP);
  queue_id := 'search-sync:' || TG_ARGV[0] || ':' || v_source_id;
  INSERT INTO "search_sync_queue" (
    "id", "resource_type", "source_id", "status", "attempts", "available_at",
    "source_updated_at", "created_at", "updated_at"
  ) VALUES (
    queue_id, TG_ARGV[0], v_source_id, 'pending', 0, CURRENT_TIMESTAMP,
    v_source_updated_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("resource_type", "source_id") DO UPDATE SET
    "status" = 'pending',
    "available_at" = CURRENT_TIMESTAMP,
    "claimed_at" = NULL,
    "claimed_by" = NULL,
    "last_error_code" = NULL,
    "source_updated_at" = GREATEST("search_sync_queue"."source_updated_at", EXCLUDED."source_updated_at"),
    "updated_at" = CURRENT_TIMESTAMP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enqueue_search_profile_assets() RETURNS trigger AS $$
DECLARE
  source_row jsonb;
  v_owner_id text;
BEGIN
  source_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_owner_id := source_row ->> TG_ARGV[0];
  IF v_owner_id IS NULL OR v_owner_id = '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  INSERT INTO "search_sync_queue" (
    "id", "resource_type", "source_id", "status", "attempts", "available_at",
    "source_updated_at", "created_at", "updated_at"
  )
  SELECT
    'search-sync:asset:' || portfolio."asset_id", 'asset', portfolio."asset_id", 'pending', 0,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "profile_portfolio_assets" portfolio
  WHERE portfolio."owner_id" = v_owner_id
  ON CONFLICT ("resource_type", "source_id") DO UPDATE SET
    "status" = 'pending', "available_at" = CURRENT_TIMESTAMP, "claimed_at" = NULL,
    "claimed_by" = NULL, "last_error_code" = NULL,
    "source_updated_at" = GREATEST("search_sync_queue"."source_updated_at", EXCLUDED."source_updated_at"),
    "updated_at" = CURRENT_TIMESTAMP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "search_tasks_changed" AFTER INSERT OR UPDATE OR DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('task', 'id');
CREATE TRIGGER "search_posts_changed" AFTER INSERT OR UPDATE OR DELETE ON "posts"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('community', 'id');
CREATE TRIGGER "search_profiles_changed" AFTER INSERT OR UPDATE OR DELETE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('user', 'user_id');
CREATE TRIGGER "search_profile_assets_changed" AFTER INSERT OR UPDATE OR DELETE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_profile_assets('user_id');
CREATE TRIGGER "search_users_changed" AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('user', 'id');
CREATE TRIGGER "search_user_assets_changed" AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_profile_assets('id');
CREATE TRIGGER "search_media_assets_changed" AFTER INSERT OR UPDATE OR DELETE ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('asset', 'id');
CREATE TRIGGER "search_portfolio_assets_changed" AFTER INSERT OR UPDATE OR DELETE ON "profile_portfolio_assets"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('asset', 'asset_id');
CREATE TRIGGER "search_task_proposals_changed" AFTER INSERT OR UPDATE OR DELETE ON "task_proposals"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('task', 'task_id');
CREATE TRIGGER "search_task_submissions_changed" AFTER INSERT OR UPDATE OR DELETE ON "task_submissions"
  FOR EACH ROW EXECUTE FUNCTION enqueue_search_resource('task', 'task_id');

INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
SELECT 'search-sync:task:' || "id", 'task', "id", 'pending', 0, CURRENT_TIMESTAMP, "updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "tasks"
ON CONFLICT ("resource_type", "source_id") DO NOTHING;
INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
SELECT 'search-sync:community:' || "id", 'community', "id", 'pending', 0, CURRENT_TIMESTAMP, "updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "posts"
ON CONFLICT ("resource_type", "source_id") DO NOTHING;
INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
SELECT 'search-sync:user:' || "user_id", 'user', "user_id", 'pending', 0, CURRENT_TIMESTAMP, "updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "profiles"
ON CONFLICT ("resource_type", "source_id") DO NOTHING;
INSERT INTO "search_sync_queue" ("id", "resource_type", "source_id", "status", "attempts", "available_at", "source_updated_at", "created_at", "updated_at")
SELECT 'search-sync:asset:' || "id", 'asset', "id", 'pending', 0, CURRENT_TIMESTAMP, "updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "media_assets"
ON CONFLICT ("resource_type", "source_id") DO NOTHING;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('admin:search:read', 'search-discovery', 'search_index', 'read', 'high', false, false, 'Read search index synchronization status and bounded diagnostics', CURRENT_TIMESTAMP),
  ('admin:search:manage', 'search-discovery', 'search_index', 'manage', 'critical', true, true, 'Process search synchronization failures and request bounded index rebuilds', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:search:read'),
  ('admin', 'admin:search:read'),
  ('admin', 'admin:search:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
