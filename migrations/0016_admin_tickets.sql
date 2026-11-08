-- 浏览器登录后台的一次性票据：网页生成 nonce → Bot 校验超管身份 → 回一条带 ticket 的链接
CREATE TABLE IF NOT EXISTS admin_tickets (
  nonce TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  ticket TEXT,
  user_id INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admin_tickets_ticket ON admin_tickets(ticket);
