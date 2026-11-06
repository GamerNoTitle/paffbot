-- 超时/失败后改成结果的消息，延迟一段时间自动删除，避免群里堆积
CREATE TABLE IF NOT EXISTS message_purges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  due_at     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_purges_due ON message_purges(due_at);
