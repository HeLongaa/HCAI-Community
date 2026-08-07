CREATE TABLE "inspiration_categories" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inspiration_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspiration_categories_slug_key" ON "inspiration_categories"("slug");
CREATE INDEX "inspiration_categories_kind_active_sort_order_idx" ON "inspiration_categories"("kind", "active", "sort_order");

CREATE TABLE "inspiration_entries" (
  "id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "category_id" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "content_type" TEXT NOT NULL,
  "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "difficulty" TEXT NOT NULL DEFAULT 'beginner',
  "tool_models" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "source_attribution" TEXT,
  "license" TEXT,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "supports_task_draft" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "review_note" TEXT,
  "published_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inspiration_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inspiration_entries_status_featured_sort_order_published_at_idx" ON "inspiration_entries"("status", "featured", "sort_order", "published_at");
CREATE INDEX "inspiration_entries_category_id_status_published_at_idx" ON "inspiration_entries"("category_id", "status", "published_at");
CREATE INDEX "inspiration_entries_author_id_status_updated_at_idx" ON "inspiration_entries"("author_id", "status", "updated_at");

CREATE TABLE "inspiration_revisions" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "review_note" TEXT,
  "created_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspiration_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspiration_revisions_entry_id_version_key" ON "inspiration_revisions"("entry_id", "version");
CREATE INDEX "inspiration_revisions_status_created_at_idx" ON "inspiration_revisions"("status", "created_at");

CREATE TABLE "inspiration_favorites" (
  "entry_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspiration_favorites_pkey" PRIMARY KEY ("entry_id", "user_id")
);

CREATE INDEX "inspiration_favorites_user_id_created_at_idx" ON "inspiration_favorites"("user_id", "created_at");

CREATE TABLE "inspiration_usage" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "entry_version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspiration_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inspiration_usage_entry_id_action_created_at_idx" ON "inspiration_usage"("entry_id", "action", "created_at");
CREATE INDEX "inspiration_usage_user_id_created_at_idx" ON "inspiration_usage"("user_id", "created_at");

ALTER TABLE "inspiration_entries" ADD CONSTRAINT "inspiration_entries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspiration_entries" ADD CONSTRAINT "inspiration_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspiration_entries" ADD CONSTRAINT "inspiration_entries_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inspiration_entries" ADD CONSTRAINT "inspiration_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inspiration_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspiration_revisions" ADD CONSTRAINT "inspiration_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inspiration_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspiration_revisions" ADD CONSTRAINT "inspiration_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspiration_revisions" ADD CONSTRAINT "inspiration_revisions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inspiration_favorites" ADD CONSTRAINT "inspiration_favorites_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inspiration_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspiration_favorites" ADD CONSTRAINT "inspiration_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspiration_usage" ADD CONSTRAINT "inspiration_usage_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inspiration_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspiration_usage" ADD CONSTRAINT "inspiration_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "inspiration_categories" ("id", "kind", "slug", "name_en", "name_zh", "description", "sort_order", "updated_at") VALUES
  ('inspiration-category-skills', 'content_type', 'skills', 'Skills', 'Skills', 'Reusable capabilities that can be applied directly.', 10, CURRENT_TIMESTAMP),
  ('inspiration-category-workflows', 'content_type', 'workflows', 'Methods & Workflows', '方法与工作流', 'Structured methods and repeatable workflows.', 20, CURRENT_TIMESTAMP),
  ('inspiration-category-templates', 'content_type', 'templates', 'Templates', '模板', 'Structured starting points for repeatable work.', 30, CURRENT_TIMESTAMP),
  ('inspiration-category-prompts', 'content_type', 'prompt-packs', 'Prompt Packs', '提示词包', 'Curated prompt systems with usage guidance.', 40, CURRENT_TIMESTAMP),
  ('inspiration-category-tutorials', 'content_type', 'tutorials', 'Tutorials', '教程', 'Step-by-step learning resources.', 50, CURRENT_TIMESTAMP),
  ('inspiration-category-cases', 'content_type', 'case-studies', 'Case Studies', '案例复盘', 'Reviewed project outcomes and lessons.', 60, CURRENT_TIMESTAMP);
