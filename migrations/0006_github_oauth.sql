-- GitHub OAuth 绑定：Telegram 用户 ↔ GitHub 账号
CREATE TABLE IF NOT EXISTS github_accounts (
  telegram_user_id INTEGER PRIMARY KEY,
  github_id        INTEGER,
  github_login     TEXT NOT NULL,
  bound_at         INTEGER NOT NULL,
  method           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_accounts_login ON github_accounts(github_login);

-- OAuth state（一次性，防 CSRF）
CREATE TABLE IF NOT EXISTS oauth_states (
  state            TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  verification_id  TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  used_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
