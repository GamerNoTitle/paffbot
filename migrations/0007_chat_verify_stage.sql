-- 聊天验证分两步：先收 GitHub 用户名，再收签名
ALTER TABLE chat_verifications ADD COLUMN stage TEXT NOT NULL DEFAULT 'username';
