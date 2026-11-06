-- 每个群自己的 bot 白名单：只有这里的 bot 能在群里发言
CREATE TABLE IF NOT EXISTS allowed_bots (
  chat_id    INTEGER NOT NULL,
  bot_id     INTEGER NOT NULL,
  username   TEXT,
  added_by   INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, bot_id)
);
