-- 浏览器独立校验的一次性挑战（nonce 消费后不可重放）
CREATE TABLE IF NOT EXISTS challenges (
  nonce      TEXT PRIMARY KEY,
  ip         TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
