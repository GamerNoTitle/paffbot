-- 聊天内验证：用户发 /verify <github 用户名> 后暂存，等下一条消息里的签名
CREATE TABLE IF NOT EXISTS chat_verifications (
  user_id    INTEGER PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
