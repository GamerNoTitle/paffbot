import { sha256Hex, stableStringify } from "../lib/crypto";
import { nowMs } from "../lib/time";

/**
 * 审计日志：append-only + 哈希链。
 *
 * hash = sha256(prev_hash + 本条记录的全部字段)，因此事后删掉/改动任意一条，
 * 后面的链就对不上。verifyAuditChain() 可以从头重算并指出断点。
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

export const GENESIS_HASH = "0".repeat(64);

function canonical(parts: {
  ts: number;
  actorId: number;
  actorType: string;
  action: string;
  chatId: number | null;
  targetUserId: number | null;
  verificationId: string | null;
  detail: string | null;
}): string {
  return [
    parts.ts,
    parts.actorId,
    parts.actorType,
    parts.action,
    parts.chatId ?? "",
    parts.targetUserId ?? "",
    parts.verificationId ?? "",
    parts.detail ?? "",
  ].join("\n");
}

export async function appendAudit(db: D1Database, input: AuditInput): Promise<string> {
  const prev = await db.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").first<{ hash: string }>();
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const ts = nowMs();
  const detail = input.detail ? stableStringify(input.detail) : null;
  const hash = await sha256Hex(
    prevHash +
      "\n" +
      canonical({
        ts,
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        chatId: input.chatId ?? null,
        targetUserId: input.targetUserId ?? null,
        verificationId: input.verificationId ?? null,
        detail,
      }),
  );

  await db
    .prepare(
      `INSERT INTO audit_log
        (ts, actor_id, actor_type, action, chat_id, target_user_id, verification_id, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ts,
      input.actorId,
      input.actorType,
      input.action,
      input.chatId ?? null,
      input.targetUserId ?? null,
      input.verificationId ?? null,
      detail,
      prevHash,
      hash,
    )
    .run();

  return hash;
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
export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtId: number | null;
}

/** 逐条校验哈希链，审计页的「完整性」徽标用它。 */
export async function verifyAuditChain(db: D1Database, limit = 5000): Promise<ChainVerification> {
  const { results } = await db
    .prepare("SELECT * FROM audit_log ORDER BY id ASC LIMIT ?")
    .bind(limit)
    .all<AuditRow>();
  let prevHash = GENESIS_HASH;
  let checked = 0;
  for (const row of results ?? []) {
    const expected = await sha256Hex(
      prevHash +
        "\n" +
        canonical({
          ts: row.ts,
          actorId: row.actor_id,
          actorType: row.actor_type,
          action: row.action,
          chatId: row.chat_id,
          targetUserId: row.target_user_id,
          verificationId: row.verification_id,
          detail: row.detail,
        }),
    );
    checked += 1;
    if (row.prev_hash !== prevHash || row.hash !== expected) {
      return { ok: false, checked, brokenAtId: row.id };
    }
    prevHash = row.hash;
  }
  return { ok: true, checked, brokenAtId: null };
}
