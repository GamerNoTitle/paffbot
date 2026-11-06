-- 允许只按用户名登记（拿不到 id 时也能加白名单）
DROP TABLE IF EXISTS allowed_bots;

CREATE TABLE allowed_bots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL,
  bot_id     INTEGER,
  username   TEXT,
  added_by   INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_allowed_bots_id
  ON allowed_bots(chat_id, bot_id) WHERE bot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_allowed_bots_name
  ON allowed_bots(chat_id, lower(username)) WHERE username IS NOT NULL;
