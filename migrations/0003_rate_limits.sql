-- 每日尝试次数限流：key = tg:<user_id> / ip:<addr>，day = 北京时间的日序号
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT NOT NULL,
  day        INTEGER NOT NULL,
  count      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_day ON rate_limits(day);
