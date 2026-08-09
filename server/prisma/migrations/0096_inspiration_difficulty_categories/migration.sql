INSERT INTO "inspiration_categories" (
  "id", "kind", "slug", "name_en", "name_zh", "description", "sort_order", "created_at", "updated_at"
)
VALUES
  ('inspiration-difficulty-beginner', 'difficulty', 'beginner', 'Beginner', '入门', 'Suitable for first-time use.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-difficulty-intermediate', 'difficulty', 'intermediate', 'Intermediate', '进阶', 'Requires some prior experience.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-difficulty-professional', 'difficulty', 'professional', 'Professional', '专业', 'Designed for advanced production work.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
