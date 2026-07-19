CREATE TABLE "search_query_events" (
    "id" TEXT NOT NULL,
    "query_fingerprint" TEXT NOT NULL,
    "query_length" INTEGER NOT NULL,
    "resource_types" TEXT[] NOT NULL,
    "sort" TEXT NOT NULL,
    "actor_class" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL,
    "has_next_page" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER NOT NULL,
    "result_document_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "search_query_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_query_events_query_length_check" CHECK ("query_length" BETWEEN 2 AND 120),
    CONSTRAINT "search_query_events_sort_check" CHECK ("sort" IN ('relevance', 'recent', 'popular')),
    CONSTRAINT "search_query_events_actor_class_check" CHECK ("actor_class" IN ('anonymous', 'authenticated')),
    CONSTRAINT "search_query_events_result_count_check" CHECK ("result_count" BETWEEN 0 AND 50),
    CONSTRAINT "search_query_events_duration_check" CHECK ("duration_ms" BETWEEN 0 AND 60000),
    CONSTRAINT "search_query_events_fingerprint_check" CHECK ("query_fingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "search_click_events" (
    "id" TEXT NOT NULL,
    "query_event_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "search_click_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_click_events_resource_type_check" CHECK ("resource_type" IN ('task', 'community', 'user', 'asset')),
    CONSTRAINT "search_click_events_position_check" CHECK ("position" BETWEEN 1 AND 50)
);

CREATE TABLE "search_ranking_controls" (
    "id" TEXT NOT NULL,
    "relevance_weight" INTEGER NOT NULL DEFAULT 100,
    "recency_weight" INTEGER NOT NULL DEFAULT 15,
    "popularity_weight" INTEGER NOT NULL DEFAULT 20,
    "zero_result_alert_rate_bps" INTEGER NOT NULL DEFAULT 2500,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reason_code" TEXT NOT NULL,
    "updated_by_ref" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "search_ranking_controls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_ranking_controls_weights_check" CHECK (
      "relevance_weight" BETWEEN 0 AND 100 AND "recency_weight" BETWEEN 0 AND 100 AND "popularity_weight" BETWEEN 0 AND 100
    ),
    CONSTRAINT "search_ranking_controls_threshold_check" CHECK ("zero_result_alert_rate_bps" BETWEEN 0 AND 10000),
    CONSTRAINT "search_ranking_controls_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "search_click_events_query_event_id_document_id_key" ON "search_click_events"("query_event_id", "document_id");
CREATE INDEX "search_query_events_created_at_idx" ON "search_query_events"("created_at");
CREATE INDEX "search_query_events_result_count_created_at_idx" ON "search_query_events"("result_count", "created_at");
CREATE INDEX "search_query_events_query_fingerprint_created_at_idx" ON "search_query_events"("query_fingerprint", "created_at");
CREATE INDEX "search_click_events_document_id_created_at_idx" ON "search_click_events"("document_id", "created_at");
CREATE INDEX "search_click_events_resource_type_created_at_idx" ON "search_click_events"("resource_type", "created_at");

ALTER TABLE "search_click_events"
  ADD CONSTRAINT "search_click_events_query_event_id_fkey"
  FOREIGN KEY ("query_event_id") REFERENCES "search_query_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "search_ranking_controls" (
  "id", "relevance_weight", "recency_weight", "popularity_weight",
  "zero_result_alert_rate_bps", "version", "reason_code", "updated_at"
) VALUES ('default', 100, 15, 20, 2500, 0, 'search_02_default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
