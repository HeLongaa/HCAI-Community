INSERT INTO "inspiration_categories" (
  "id", "kind", "slug", "name_en", "name_zh", "description", "sort_order", "created_at", "updated_at"
)
VALUES
  ('inspiration-domain-image', 'domain', 'image', 'Image', '图片', 'Image creation and editing.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-video', 'domain', 'video', 'Video', '视频', 'Video creation and production.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-music', 'domain', 'music', 'Music', '音乐', 'Music and audio creation.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-writing', 'domain', 'writing', 'Writing & Script', '文案与脚本', 'Writing, copy, and scripts.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-assistant', 'domain', 'assistant', 'Assistant', '对话与助手', 'Conversational assistants and agents.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-automation', 'domain', 'automation', 'Automation', '自动化', 'Repeatable automated workflows.', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-marketing', 'domain', 'marketing', 'Marketing', '营销', 'Marketing and growth use cases.', 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inspiration-domain-education', 'domain', 'education', 'Education', '教育', 'Learning and teaching use cases.', 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
