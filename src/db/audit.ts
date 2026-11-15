import { stableStringify } from "../lib/crypto";
import { nowMs } from "../lib/time";

/**
 * 审计日志：只追加的流水。
 *
 * 曾经带哈希链（prev_hash/hash）并在页面上逐行重算校验，后来去掉了：
 * 链没有密钥参与，能改库的人顺手就能重算整条链，防不住真正的篡改；
 * 而每次打开审计页都要跑上百次 SHA-256，在免费套餐下直接超 CPU。
 */

export type ActorType = "super_admin" | "group_admin" | "system" | "user";

export interface AuditInput {
  actorId: number;
  actorType: ActorType;
  action: string;
  chatId?: number | null;
  targetUserId?: number | null;
  verificationId?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface AuditRow {
  chat_title?: string | null;
  id: number;
  ts: number;
  actor_id: number;
  actor_type: ActorType;
  action: string;
  chat_id: number | null;
  target_user_id: number | null;
  verification_id: string | null;
  detail: string | null;
  prev_hash: string;
  hash: string;
}


export async function appendAudit(db: D1Database, input: AuditInput): Promise<void> {
  const detail = input.detail ? stableStringify(input.detail) : null;
  await db
    .prepare(
      `INSERT INTO audit_log
        (ts, actor_id, actor_type, action, chat_id, target_user_id, verification_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      nowMs(),
      input.actorId,
      input.actorType,
      input.action,
      input.chatId ?? null,
      input.targetUserId ?? null,
      input.verificationId ?? null,
      detail,
    )
    .run();
}

export interface AuditFilter {
  chatId?: number;
  targetUserId?: number;
  action?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listAudit(db: D1Database, filter: AuditFilter = {}): Promise<{ rows: AuditRow[]; total: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.chatId) {
    where.push("a.chat_id = ?");
    params.push(filter.chatId);
  }
  if (filter.targetUserId) {
    where.push("a.target_user_id = ?");
    params.push(filter.targetUserId);
  }
  if (filter.action) {
    where.push("a.action = ?");
    params.push(filter.action);
  }
  if (filter.query) {
    const q = `%${filter.query}%`;
    where.push(
      "(a.action LIKE ? OR CAST(a.target_user_id AS TEXT) LIKE ? OR CAST(a.actor_id AS TEXT) LIKE ? OR a.detail LIKE ?)",
    );
    params.push(q, q, q, q);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM audit_log a ${clause}`)
    .bind(...params)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.*, g.title AS chat_title FROM audit_log a
       LEFT JOIN groups g ON g.chat_id = a.chat_id
       ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all<AuditRow & { chat_title: string | null }>();

  return { rows: results ?? [], total: totalRow?.total ?? 0 };
}
