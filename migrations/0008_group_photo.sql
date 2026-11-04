-- 群头像：缓存 Telegram file_id，避免每次都调 getChat
ALTER TABLE groups ADD COLUMN photo_file_id TEXT;
ALTER TABLE groups ADD COLUMN photo_updated_at INTEGER;
