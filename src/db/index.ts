import { nowMs } from "../lib/time";

export type VerificationStatus = "pending" | "approved" | "declined" | "timeout" | "banned" | "blocked";
export type VerificationSource = "join_request" | "group_join" | "admin";

export interface VerificationRow {
  id: string;
  chat_id: number;
  chat_title: string | null;
  user_id: number;
  username: string | null;
  display_name: string | null;
  status: VerificationStatus;
  source: VerificationSource;
  method: string | null;
  reason: string | null;
  detail: string | null;
  operator_id: number | null;
  update_id: number | null;
  nonce: string;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
}

export interface NewVerification {
  id: string;
  chatId: number;
  chatTitle: string | null;
  userId: number;
  username: string | null;
  displayName: string | null;
  source: VerificationSource;
  status: VerificationStatus;
  reason?: string | null;
  updateId: number | null;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  detail?: Record<string, unknown> | null;
}

const PENDING = "pending";

/** 返回 true 表示这条 update 是第一次见到（应该继续处理）。 */
export async function dedupeUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_updates (update_id, received_at) VALUES (?, ?)")
    .bind(updateId, nowMs())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function createVerification(db: D1Database, row: NewVerification): Promise<void> {
  await db
    .prepare(
      `INSERT INTO verifications
        (id, chat_id, chat_title, user_id, username, display_name, status, source, method, reason, detail,
         operator_id, update_id, nonce, created_at, expires_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      row.id,
      row.chatId,
      row.chatTitle,
      row.userId,
      row.username,
      row.displayName,
      row.status,
      row.source,
      row.reason ?? null,
      row.detail ? JSON.stringify(row.detail) : null,
      row.updateId,
      row.nonce,
      row.createdAt,
      row.expiresAt,
    )
    .run();
}

export async function getVerification(db: D1Database, id: string): Promise<VerificationRow | null> {
  return db.prepare("SELECT * FROM verifications WHERE id = ?").bind(id).first<VerificationRow>();
}

/** 某个用户当前还能用的 pending 记录（优先最近一条）。 */
export async function findOpenVerification(db: D1Database, userId: number): Promise<VerificationRow | null> {
  return db
    .prepare(
      `SELECT * FROM verifications
       WHERE user_id = ? AND status = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, PENDING, nowMs())
    .first<VerificationRow>();
}

/** 最近一段时间内已被批准的记录：用来避免 chat_member 又把刚放行的人禁言。 */
/* ------------------------------------------------------------ bot 白名单 */

export interface AllowedBotRow {
  bot_id: number | null;
  username: string | null;
}

export async function addAllowedBot(
  db: D1Database,
  chatId: number,
  botId: number | null,
  username: string | null,
  addedBy: number | null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO allowed_bots (chat_id, bot_id, username, added_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(chatId, botId ?? null, username ?? null, addedBy ?? null, Date.now())
    .run();
}

export async function removeAllowedBot(db: D1Database, chatId: number, botId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM allowed_bots WHERE chat_id = ? AND bot_id = ?").bind(chatId, botId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function listAllowedBots(db: D1Database, chatId: number): Promise<AllowedBotRow[]> {
  const { results } = await db
    .prepare("SELECT bot_id, username FROM allowed_bots WHERE chat_id = ? ORDER BY created_at ASC")
    .bind(chatId)
    .all<AllowedBotRow>();
  return results ?? [];
}

/** 命中白名单：按 id 或用户名都算。命中用户名时顺手把 id 补上。 */
export async function matchAllowedBot(
  db: D1Database,
  chatId: number,
  botId: number,
  username: string | null,
): Promise<boolean> {
  const byId = await db
    .prepare("SELECT id FROM allowed_bots WHERE chat_id = ? AND bot_id = ?")
    .bind(chatId, botId)
    .first<{ id: number }>();
  if (byId) return true;

  if (!username) return false;
  const byName = await db
    .prepare("SELECT id FROM allowed_bots WHERE chat_id = ? AND lower(username) = lower(?)")
    .bind(chatId, username)
    .first<{ id: number }>();
  if (!byName) return false;

  await db
    .prepare("UPDATE allowed_bots SET bot_id = ? WHERE id = ?")
    .bind(botId, byName.id)
    .run()
    .catch(() => undefined);
  return true;
}

/** 排一条"到点删除"的群消息。 */
export async function scheduleMessagePurge(
  db: D1Database,
  chatId: number,
  messageId: number,
  dueAt: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO message_purges (chat_id, message_id, due_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(chatId, messageId, dueAt, Date.now())
    .run();
}

export async function listDuePurges(
  db: D1Database,
  now: number,
  limit = 50,
): Promise<Array<{ id: number; chat_id: number; message_id: number }>> {
  const { results } = await db
    .prepare("SELECT id, chat_id, message_id FROM message_purges WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?")
    .bind(now, limit)
    .all<{ id: number; chat_id: number; message_id: number }>();
  return results ?? [];
}

export async function deletePurge(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM message_purges WHERE id = ?").bind(id).run();
}

export async function findRecentlyApprovedForChat(
  db: D1Database,
  chatId: number,
  userId: number,
  sinceMs: number,
): Promise<VerificationRow | null> {
  return db
    .prepare(
      `SELECT * FROM verifications
       WHERE chat_id = ? AND user_id = ? AND status = 'approved' AND COALESCE(decided_at, created_at) > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(chatId, userId, sinceMs)
    .first<VerificationRow>();
}

export async function findOpenVerificationForChat(
  db: D1Database,
  chatId: number,
  userId: number,
): Promise<VerificationRow | null> {
  return db
    .prepare(
      `SELECT * FROM verifications
       WHERE chat_id = ? AND user_id = ? AND status = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(chatId, userId, PENDING, nowMs())
    .first<VerificationRow>();
}

/**
 * 条件更新（CAS）：只有 status='pending' 时才会改，保证 webhook 重投 / 双端并发时只生效一次。
 */
export async function decideVerification(
  db: D1Database,
  id: string,
  patch: {
    status: VerificationStatus;
    method?: string | null;
    reason?: string | null;
    operatorId?: number | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE verifications
          SET status = ?, method = COALESCE(?, method), reason = COALESCE(?, reason),
              operator_id = COALESCE(?, operator_id), decided_at = ?,
              detail = COALESCE(?, detail)
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(
      patch.status,
      patch.method ?? null,
      patch.reason ?? null,
      patch.operatorId ?? null,
      nowMs(),
      patch.detail ? JSON.stringify(patch.detail) : null,
      id,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** 只改到期时间（人机验证通过后延长保留时限）。 */
export async function extendVerificationExpiry(db: D1Database, id: string, expiresAt: number): Promise<void> {
  await db.prepare("UPDATE verifications SET expires_at = ? WHERE id = ?").bind(expiresAt, id).run();
}

export async function updateVerificationDetail(
  db: D1Database,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await getVerification(db, id);
  if (!row) return;
  const current = parseDetail(row.detail);
  await db
    .prepare("UPDATE verifications SET detail = ? WHERE id = ?")
    .bind(JSON.stringify({ ...current, ...patch }), id)
    .run();
}

export async function listExpiredPending(db: D1Database, limit = 50): Promise<VerificationRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM verifications WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC LIMIT ?")
    .bind(nowMs(), limit)
    .all<VerificationRow>();
  return results ?? [];
}

export interface VerifyFilter {
  chatId?: number;
  userId?: number;
  status?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listVerifications(
  db: D1Database,
  filter: VerifyFilter = {},
): Promise<{ rows: VerificationRow[]; total: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.chatId) {
    where.push("chat_id = ?");
    params.push(filter.chatId);
  }
  if (filter.userId) {
    where.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.query) {
    const q = `%${filter.query}%`;
    where.push(
      "(CAST(user_id AS TEXT) LIKE ? OR display_name LIKE ? OR username LIKE ? OR id LIKE ? OR method LIKE ? OR reason LIKE ?)",
    );
    params.push(q, q, q, q, q, q);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM verifications ${clause}`)
    .bind(...params)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM verifications ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<VerificationRow>();

  return { rows: results ?? [], total: countRow?.total ?? 0 };
}

export async function countPending(db: D1Database, chatId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM verifications WHERE chat_id = ? AND status = 'pending'")
    .bind(chatId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function verificationStats(db: D1Database, chatId?: number): Promise<Record<string, number>> {
  const sql = chatId
    ? "SELECT status, COUNT(*) AS total FROM verifications WHERE chat_id = ? GROUP BY status"
    : "SELECT status, COUNT(*) AS total FROM verifications GROUP BY status";
  const stmt = chatId ? db.prepare(sql).bind(chatId) : db.prepare(sql);
  const { results } = await stmt.all<{ status: string; total: number }>();
  const out: Record<string, number> = {};
  for (const row of results ?? []) out[row.status] = row.total;
  return out;
}

// ---------------------------------------------------------------- rate limits

/** 北京时间（UTC+8）的日序号，用于「一天内」的窗口。 */
export function dayIndexOf(now = nowMs()): number {
  return Math.floor((now + 8 * 3600 * 1000) / 86_400_000);
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * 消耗一次每日配额。达到上限后返回 allowed=false（不再自增，避免持续膨胀）。
 */
export async function consumeDailyQuota(
  db: D1Database,
  key: string,
  limit: number,
  day = dayIndexOf(),
): Promise<QuotaResult> {
  const row = await db
    .prepare("SELECT count FROM rate_limits WHERE key = ? AND day = ?")
    .bind(key, day)
    .first<{ count: number }>();
  const used = row?.count ?? 0;

  if (used >= limit) return { allowed: false, used, limit };

  await db
    .prepare(
      `INSERT INTO rate_limits (key, day, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(key, day) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
    )
    .bind(key, day, nowMs())
    .run();

  return { allowed: true, used: used + 1, limit };
}

export async function pruneRateLimits(db: D1Database, keepDays = 7): Promise<number> {
  const cutoff = dayIndexOf() - keepDays;
  const result = await db.prepare("DELETE FROM rate_limits WHERE day < ?").bind(cutoff).run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------- github binding

export interface GithubAccountRow {
  telegram_user_id: number;
  github_id: number | null;
  github_login: string;
  bound_at: number;
  method: string;
}

export async function upsertGithubAccount(
  db: D1Database,
  telegramUserId: number,
  login: string,
  githubId: number | null,
  method: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO github_accounts (telegram_user_id, github_id, github_login, bound_at, method)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET github_id = excluded.github_id,
         github_login = excluded.github_login, bound_at = excluded.bound_at, method = excluded.method`,
    )
    .bind(telegramUserId, githubId, login, nowMs(), method)
    .run();
}

export async function getGithubAccount(
  db: D1Database,
  telegramUserId: number,
): Promise<GithubAccountRow | null> {
  return db
    .prepare("SELECT * FROM github_accounts WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<GithubAccountRow>();
}

export interface OAuthStateRow {
  state: string;
  telegram_user_id: number;
  verification_id: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export async function createOAuthState(
  db: D1Database,
  state: string,
  telegramUserId: number,
  verificationId: string | null,
  ttlMs: number,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO oauth_states (state, telegram_user_id, verification_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    )
    .bind(state, telegramUserId, verificationId, nowMs(), nowMs() + ttlMs)
    .run();
}

/** 原子消费：只有未使用且未过期的 state 才返回。 */
export async function consumeOAuthState(db: D1Database, state: string): Promise<OAuthStateRow | null> {
  const now = nowMs();
  const row = await db
    .prepare("SELECT * FROM oauth_states WHERE state = ? AND used_at IS NULL AND expires_at > ?")
    .bind(state, now)
    .first<OAuthStateRow>();
  if (!row) return null;
  const result = await db
    .prepare("UPDATE oauth_states SET used_at = ? WHERE state = ? AND used_at IS NULL")
    .bind(now, state)
    .run();
  return (result.meta.changes ?? 0) > 0 ? row : null;
}

// ---------------------------------------------------------------- chat verify

export interface ChatVerifyRow {
  user_id: number;
  username: string;
  stage: string;
  created_at: number;
  expires_at: number;
}

export async function setChatVerify(
  db: D1Database,
  userId: number,
  username: string,
  stage: "username" | "signature",
  ttlMs: number,
): Promise<void> {
  const now = nowMs();
  await db
    .prepare(
      `INSERT INTO chat_verifications (user_id, username, stage, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, stage = excluded.stage,
         created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .bind(userId, username, stage, now, now + ttlMs)
    .run();
}

export async function getChatVerify(db: D1Database, userId: number): Promise<ChatVerifyRow | null> {
  return db
    .prepare("SELECT * FROM chat_verifications WHERE user_id = ?")
    .bind(userId)
    .first<ChatVerifyRow>();
}

export async function clearChatVerify(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM chat_verifications WHERE user_id = ?").bind(userId).run();
}

/** 该用户最近一条仍有效的待验证记录（不论在哪个群）。 */
export async function findLatestPendingForUser(
  db: D1Database,
  userId: number,
): Promise<VerificationRow | null> {
  return db
    .prepare(
      `SELECT * FROM verifications WHERE user_id = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, nowMs())
    .first<VerificationRow>();
}

// ---------------------------------------------------------------- groups

export async function upsertGroup(db: D1Database, chatId: number, title: string | null): Promise<void> {
  const now = nowMs();
  await db
    .prepare(
      `INSERT INTO groups (chat_id, title, mode, created_at, updated_at) VALUES (?, ?, 'auto', ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET title = COALESCE(excluded.title, groups.title), updated_at = excluded.updated_at`,
    )
    .bind(chatId, title, now, now)
    .run();
}

/** 群头像缓存（file_id 由 getChat 取得）。 */
export async function setGroupPhoto(db: D1Database, chatId: number, fileId: string): Promise<void> {
  await db
    .prepare("UPDATE groups SET photo_file_id = ?, photo_updated_at = ? WHERE chat_id = ?")
    .bind(fileId, nowMs(), chatId)
    .run();
}

export async function getGroupPhoto(
  db: D1Database,
  chatId: number,
): Promise<{ fileId: string | null; updatedAt: number }> {
  const row = await db
    .prepare("SELECT photo_file_id, photo_updated_at FROM groups WHERE chat_id = ?")
    .bind(chatId)
    .first<{ photo_file_id: string | null; photo_updated_at: number | null }>();
  return { fileId: row?.photo_file_id ?? null, updatedAt: row?.photo_updated_at ?? 0 };
}

// ---------------------------------------------------------------- admin cache

export async function getCachedAdmin(db: D1Database, chatId: number, userId: number): Promise<boolean | null> {
  const row = await db
    .prepare("SELECT is_admin, expires_at FROM admin_cache WHERE chat_id = ? AND user_id = ?")
    .bind(chatId, userId)
    .first<{ is_admin: number; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= nowMs()) return null;
  return row.is_admin === 1;
}

export async function cacheAdmin(db: D1Database, chatId: number, userId: number, isAdmin: boolean, ttlMs = 60_000): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_cache (chat_id, user_id, is_admin, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET is_admin = excluded.is_admin, expires_at = excluded.expires_at`,
    )
    .bind(chatId, userId, isAdmin ? 1 : 0, nowMs() + ttlMs)
    .run();
}

export function parseDetail(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 清理陈旧（已结案）的验证记录；审计日志不动。 */
export async function pruneOldVerifications(db: D1Database, retentionDays: number): Promise<number> {
  const cutoff = nowMs() - retentionDays * 24 * 3600 * 1000;
  const result = await db
    .prepare("DELETE FROM verifications WHERE created_at < ? AND status <> 'pending'")
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}
